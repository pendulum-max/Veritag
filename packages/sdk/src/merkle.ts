import { Buffer } from "buffer";
import { Address, hash as stellarSha256, nativeToScVal } from "@stellar/stellar-sdk";

export const MAX_PROOF_DEPTH = 32;

export function toBytes(input: Uint8Array | string): Buffer {
  if (typeof input === "string") {
    return Buffer.from(input, "utf8");
  }
  return Buffer.from(input);
}

export function hexToBytes32(hex: string): Buffer {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new Error(`Expected 32-byte hex string (64 hex chars), got length ${clean.length}`);
  }
  return Buffer.from(clean, "hex");
}

export function sha256(data: Uint8Array | string): Buffer {
  return Buffer.from(stellarSha256(toBytes(data)));
}

export function computeSerialHash(serial: Uint8Array | string): Buffer {
  return sha256(serial);
}

export function computeSecretHash(secret: Uint8Array | string): Buffer {
  return sha256(secret);
}

/**
 * Matches Soroban contract `merkle::compute_leaf`:
 * `leaf = sha256(serial_hash || secret_hash)`
 */
export function computeLeaf(serialHash: Uint8Array, secretHash: Uint8Array): Buffer {
  if (serialHash.length !== 32 || secretHash.length !== 32) {
    throw new Error("serialHash and secretHash must each be 32 bytes");
  }
  return sha256(Buffer.concat([Buffer.from(serialHash), Buffer.from(secretHash)]));
}

/**
 * Matches Soroban contract `merkle::compute_unit_id`:
 * `unit_id = sha256(brand.to_xdr() || batch_id || serial_hash)`
 */
export function computeUnitId(
  brandAddress: string,
  batchId: Uint8Array,
  serialHash: Uint8Array,
): Buffer {
  if (batchId.length !== 32 || serialHash.length !== 32) {
    throw new Error("batchId and serialHash must each be 32 bytes");
  }
  const brandScVal = nativeToScVal(Address.fromString(brandAddress), { type: "address" });
  const brandXdr = Buffer.from(brandScVal.toXDR());
  return sha256(Buffer.concat([brandXdr, Buffer.from(batchId), Buffer.from(serialHash)]));
}

/**
 * Sorted-pair internal node hash matching Soroban contract `merkle::hash_pair`:
 * `sha256(min(a, b) || max(a, b))`
 */
export function hashPair(a: Uint8Array, b: Uint8Array): Buffer {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== 32 || bufB.length !== 32) {
    throw new Error("Merkle node hashes must be 32 bytes");
  }
  const ordered = Buffer.compare(bufA, bufB) <= 0 ? [bufA, bufB] : [bufB, bufA];
  return sha256(Buffer.concat(ordered));
}

export function verifyMerkleProof(
  merkleRoot: Uint8Array,
  leaf: Uint8Array,
  proof: readonly Uint8Array[],
): boolean {
  if (proof.length > MAX_PROOF_DEPTH || merkleRoot.length !== 32 || leaf.length !== 32) {
    return false;
  }
  let computed: Buffer = Buffer.from(leaf);
  for (const sibling of proof) {
    if (sibling.length !== 32) {
      return false;
    }
    computed = hashPair(computed, sibling);
  }
  return Buffer.compare(computed, Buffer.from(merkleRoot)) === 0;
}

export class MerkleTree {
  private readonly layers: Buffer[][];

  constructor(leaves: readonly Uint8Array[]) {
    if (leaves.length === 0) {
      throw new Error("Cannot construct MerkleTree from an empty leaf list");
    }
    const baseLayer = leaves.map((leaf) => {
      if (leaf.length !== 32) {
        throw new Error("All leaves must be 32-byte hashes");
      }
      return Buffer.from(leaf);
    });

    this.layers = [baseLayer];
    while (this.layers[this.layers.length - 1]!.length > 1) {
      const current = this.layers[this.layers.length - 1]!;
      const next: Buffer[] = [];
      for (let i = 0; i < current.length; i += 2) {
        const left = current[i]!;
        const right = i + 1 < current.length ? current[i + 1]! : left;
        next.push(hashPair(left, right));
      }
      this.layers.push(next);
    }
  }

  get root(): Buffer {
    return Buffer.from(this.layers[this.layers.length - 1]![0]!);
  }

  get leafCount(): number {
    return this.layers[0]!.length;
  }

  getProof(index: number): Buffer[] {
    const base = this.layers[0]!;
    if (!Number.isInteger(index) || index < 0 || index >= base.length) {
      throw new RangeError(`Leaf index ${index} out of bounds (0..${base.length - 1})`);
    }
    const proof: Buffer[] = [];
    let idx = index;
    for (let level = 0; level < this.layers.length - 1; level++) {
      const layer = this.layers[level]!;
      const siblingIdx =
        idx % 2 === 0 ? (idx + 1 < layer.length ? idx + 1 : idx) : idx - 1;
      proof.push(Buffer.from(layer[siblingIdx]!));
      idx = Math.floor(idx / 2);
    }
    return proof;
  }
}
