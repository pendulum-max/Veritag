import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import {
  MerkleTree,
  computeLeaf,
  computeSecretHash,
  computeSerialHash,
  computeUnitId,
  sha256,
} from "@veritag/sdk";
import type { BatchRecord, BatchUnitProvisionRecord } from "../db/repository.js";

export interface BuildBatchParams {
  brand: string;
  batchCode: string;
  warrantyMonths: number;
  productMeta: string | Record<string, unknown>;
  count?: number;
  serials?: string[];
  encryptionKeySecret: string;
}

export interface BuiltBatchBundle {
  batch: BatchRecord;
  units: BatchUnitProvisionRecord[];
}

function deriveAesKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(plainSecret: string, keySecret: string): string {
  const key = deriveAesKey(keySecret);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainSecret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${ciphertext.toString("hex")}`;
}

export function decryptSecret(payload: string, keySecret: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(":");
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error("MalformedEncryptedSecret");
  }
  const key = deriveAesKey(keySecret);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const plain = Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]);
  return plain.toString("utf8");
}

function generateReadableSecret(): string {
  // 16 bytes (128-bit entropy) formatted into 4 groups of 8 uppercase hex chars for scratch-off legibility
  const hex = randomBytes(16).toString("hex").toUpperCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 16)}-${hex.slice(16, 24)}-${hex.slice(24, 32)}`;
}

export function buildProductionBatch(params: BuildBatchParams): BuiltBatchBundle {
  const serialList =
    params.serials && params.serials.length > 0
      ? params.serials
      : Array.from(
          { length: params.count ?? 0 },
          (_, idx) => `${params.batchCode}-${String(idx + 1).padStart(6, "0")}`,
        );

  if (serialList.length === 0) {
    throw new Error("Batch must contain at least one unit");
  }
  const uniqueSerials = new Set(serialList);
  if (uniqueSerials.size !== serialList.length) {
    throw new Error("Duplicate serial numbers in batch");
  }

  const batchIdBuf = sha256(params.batchCode);
  const batchIdHex = batchIdBuf.toString("hex");
  const metaString =
    typeof params.productMeta === "string"
      ? params.productMeta
      : JSON.stringify(params.productMeta);
  const productMetaHashHex = sha256(metaString).toString("hex");

  const intermediate = serialList.map((serial) => {
    const plainSecret = generateReadableSecret();
    const serialHashBuf = computeSerialHash(serial);
    const secretHashBuf = computeSecretHash(plainSecret);
    const leafBuf = computeLeaf(serialHashBuf, secretHashBuf);
    const unitIdBuf = computeUnitId(params.brand, batchIdBuf, serialHashBuf);

    return {
      serial,
      plainSecret,
      serialHashHex: serialHashBuf.toString("hex"),
      secretHashHex: secretHashBuf.toString("hex"),
      leafBuf,
      unitIdHex: unitIdBuf.toString("hex"),
    };
  });

  const tree = new MerkleTree(intermediate.map((item) => item.leafBuf));
  const merkleRootHex = tree.root.toString("hex");

  const units: BatchUnitProvisionRecord[] = intermediate.map((item, idx) => ({
    unitId: item.unitIdHex,
    brand: params.brand,
    batchId: batchIdHex,
    serial: item.serial,
    serialHash: item.serialHashHex,
    secretHash: item.secretHashHex,
    encryptedSecret: encryptSecret(item.plainSecret, params.encryptionKeySecret),
    proof: tree.getProof(idx).map((buf) => buf.toString("hex")),
    exportedAt: null,
  }));

  const batch: BatchRecord = {
    brand: params.brand,
    batchId: batchIdHex,
    merkleRoot: merkleRootHex,
    warrantyMonths: params.warrantyMonths,
    productMetaHash: productMetaHashHex,
    unitCount: units.length,
    recalled: false,
    recallReasonHash: null,
    createdAt: new Date().toISOString(),
  };

  return { batch, units };
}
