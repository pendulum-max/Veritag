import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import {
  MerkleTree,
  buildVerifyUrl,
  computeLeaf,
  computeSecretHash,
  computeSerialHash,
  computeUnitId,
  hexToBytes32,
  parseVerifyPath,
  sha256,
  verifyMerkleProof,
} from "../src/index.js";

describe("@veritag/sdk merkle & identifiers", () => {
  it("builds valid Merkle proofs for odd and even batch sizes and rejects tampering", () => {
    for (const count of [1, 2, 4, 5, 11]) {
      const units = Array.from({ length: count }, (_, idx) => {
        const serialHash = computeSerialHash(`SN-${idx + 1}`);
        const secretHash = computeSecretHash(`SECRET-${idx + 1}`);
        const leaf = computeLeaf(serialHash, secretHash);
        return { serialHash, secretHash, leaf };
      });

      const tree = new MerkleTree(units.map((u) => u.leaf));
      expect(tree.leafCount).toBe(count);

      units.forEach((unit, idx) => {
        const proof = tree.getProof(idx);
        expect(verifyMerkleProof(tree.root, unit.leaf, proof)).toBe(true);

        const wrongLeaf = computeLeaf(unit.serialHash, computeSecretHash("wrong-secret"));
        expect(verifyMerkleProof(tree.root, wrongLeaf, proof)).toBe(false);
      });
    }
  });

  it("computes deterministic 32-byte unit IDs from brand address, batchId, and serialHash", () => {
    const brand = Keypair.random().publicKey();
    const batchId = sha256("BATCH-2026-01");
    const serialHash = computeSerialHash("SN-000042");

    const id1 = computeUnitId(brand, batchId, serialHash);
    const id2 = computeUnitId(brand, hexToBytes32(batchId.toString("hex")), serialHash);
    expect(id1.length).toBe(32);
    expect(id1.equals(id2)).toBe(true);

    const otherBrand = Keypair.random().publicKey();
    expect(computeUnitId(otherBrand, batchId, serialHash).equals(id1)).toBe(false);
  });

  it("formats and parses verification QR URLs cleanly", () => {
    const brand = "GABC1234";
    const batch = "a".repeat(64);
    const serial = "SN-2026/001";
    const url = buildVerifyUrl("https://veritag.app/", brand, batch, serial);
    expect(url).toBe("https://veritag.app/v/GABC1234/" + batch + "/SN-2026%2F001");

    const parsed = parseVerifyPath(new URL(url).pathname);
    expect(parsed).toEqual({ brand, batch, serial });
  });
});
