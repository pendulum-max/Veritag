import { Keypair } from "@stellar/stellar-sdk";
import { Buffer } from "buffer";
import { describe, expect, it } from "vitest";
import {
  AccountFactoryContract,
  MerkleTree,
  P256_CURVE_ORDER,
  P256_HALF_ORDER,
  PasskeyAccountContract,
  base64UrlDecode,
  base64UrlEncode,
  buildVerifyUrl,
  computeLeaf,
  computeSecretHash,
  computeSerialHash,
  computeUnitId,
  derSignatureToCompactLowS,
  derivePasskeySalt,
  encodeQrMatrix,
  extractP256UncompressedPublicKey,
  generateQrDataUrl,
  generateQrSvg,
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

  it("extracts 65-byte P-256 public keys from SPKI DER and normalizes DER ECDSA signatures to low-S", () => {
    const fakeXY = Buffer.alloc(64, 0x33);
    const spkiHeader = Buffer.from("3059301306072a8648ce3d020106082a8648ce3d03010703420004", "hex");
    const spkiDer = Buffer.concat([spkiHeader, fakeXY]);

    const extracted = extractP256UncompressedPublicKey(spkiDer);
    expect(extracted.length).toBe(65);
    expect(extracted[0]).toBe(0x04);
    expect(extracted.subarray(1).equals(fakeXY)).toBe(true);

    // Construct an ASN.1 DER signature with s > n / 2 to verify low-S normalization
    const r = 12345678901234567890n;
    const highS = P256_HALF_ORDER + 999n;
    const expectedLowS = P256_CURVE_ORDER - highS;

    const rBytes = Buffer.from(r.toString(16).padStart(64, "0"), "hex");
    const sBytes = Buffer.concat([
      Buffer.from([0x00]),
      Buffer.from(highS.toString(16).padStart(64, "0"), "hex"),
    ]);
    const derBody = Buffer.concat([
      Buffer.from([0x02, rBytes.length]),
      rBytes,
      Buffer.from([0x02, sBytes.length]),
      sBytes,
    ]);
    const derSig = Buffer.concat([Buffer.from([0x30, derBody.length]), derBody]);

    const compact = derSignatureToCompactLowS(derSig);
    expect(compact.length).toBe(64);
    const parsedS = BigInt("0x" + compact.subarray(32, 64).toString("hex"));
    expect(parsedS).toBe(expectedLowS);
    expect(parsedS <= P256_HALF_ORDER).toBe(true);

    // Base64URL round-trip and salt derivation
    const payload = sha256("webauthn-challenge");
    const b64u = base64UrlEncode(payload);
    expect(b64u.length).toBe(43);
    expect(base64UrlDecode(b64u).equals(payload)).toBe(true);
    expect(derivePasskeySalt("cred-123").length).toBe(32);
  });

  it("generates ISO/IEC 18004 QR matrices, SVG markup, and data URLs", () => {
    const url = "https://veritag.stellar.org/v/GBRAND123/" + "b".repeat(64) + "/SN-001#s=secret123";
    const matrix = encodeQrMatrix(url);
    expect(matrix.length).toBeGreaterThanOrEqual(21);
    expect(matrix[0]?.[0]).toBe(true); // Top-left finder corner

    const svg = generateQrSvg(url, { label: "SN-001" });
    expect(svg).toContain("<svg");
    expect(svg).toContain("data-qr-payload=");
    expect(svg).toContain("<title>SN-001</title>");

    const dataUrl = generateQrDataUrl(url);
    expect(dataUrl.startsWith("data:image/svg+xml;base64,")).toBe(true);

    expect(typeof PasskeyAccountContract.Client).toBe("function");
    expect(typeof AccountFactoryContract.Client).toBe("function");
  });
});
