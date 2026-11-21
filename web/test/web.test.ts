import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCertificatePdfBytes,
  buildCertificateSvg,
} from "../lib/certificate-generator.js";
import { registerPasskeySmartWallet } from "../lib/passkey.js";
import {
  buildUnsignedRegistryTxXdr,
  getFileDownloadUrl,
  isValidGtinFormat,
  PUBLIC_CONFIG,
  resolveGs1DigitalLink,
  signRegistryTxWithSecret,
  verifyProduct,
} from "../lib/stellar.js";

describe("@veritag/web verification & passkey wallet logic", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Offline test mode")),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves offline/demo verification states accurately across serial patterns", async () => {
    const brand = "GB7TAYRUZGE6TVT7NHP5SMIZRNQA6PLM423EYISAOAP3MKYIQMVYP2JO";
    const batch = "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b";

    const unclaimed = await verifyProduct(brand, batch, "CH-2026-000101");
    expect(unclaimed.status).toBe("AuthenticInactive");
    expect(unclaimed.authentic).toBe(true);

    const active = await verifyProduct(brand, batch, "CH-2026-ACTIVE-04");
    expect(active.status).toBe("AuthenticActive");
    expect(active.unit?.warrantyValid).toBe(true);

    const dup = await verifyProduct(brand, batch, "CH-2026-DUP-88");
    expect(dup.status).toBe("AlreadyClaimedWarning");
    expect(dup.suspiciousScanVolume).toBe(true);

    const recalled = await verifyProduct(brand, batch, "CH-2026-RECALL-19");
    expect(recalled.status).toBe("Recalled");

    const fake = await verifyProduct(brand, batch, "FAKE-000999");
    expect(fake.status).toBe("Unknown");
    expect(fake.authentic).toBe(false);
  });

  it("generates P-256 passkey wallet credentials and formats file download URLs", async () => {
    const cred = await registerPasskeySmartWallet("Test Consumer Passkey");
    expect(cred.publicKeyHex.length).toBe(130);
    expect(cred.publicKeyHex.startsWith("04")).toBe(true);
    expect(cred.stellarSmartAddress.startsWith("C")).toBe(true);
    expect(cred.stellarSmartAddress.length).toBe(56);

    const fileUrl = getFileDownloadUrl("a".repeat(64));
    expect(fileUrl).toContain("/v1/files/" + "a".repeat(64));

    const kp = Keypair.random();
    const unsignedXdr = buildUnsignedRegistryTxXdr({
      callerAddress: kp.publicKey(),
      method: "commit_batch",
    });
    const signedXdr = signRegistryTxWithSecret(unsignedXdr, kp.secret());
    const parsedTx = TransactionBuilder.fromXDR(signedXdr, PUBLIC_CONFIG.networkPassphrase);
    expect(parsedTx.signatures.length).toBe(1);

    const passkeyUnsignedXdr = buildUnsignedRegistryTxXdr({
      callerAddress: cred.stellarSmartAddress,
      method: "activate",
    });
    expect(passkeyUnsignedXdr.length).toBeGreaterThan(20);
  });

  it("generates Guilloche SVG and vector PDF warranty certificates", () => {
    const certData = {
      unitId: "55aa66bb77cc88dd99ee00ff112233445566778899aabbccddeeff0011223344",
      model: "Chronos Titan Automatic 41mm",
      serial: "CH-2026-ACTIVE-04",
      brandDomain: "chronos-watches.swiss",
      ownerAddress: "GB7TAYRUZGE6TVT7NHP5SMIZRNQA6PLM423EYISAOAP3MKYIQMVYP2JO",
      txHash: "4e9b2f7a1c8d3065a2b4c6d8e0f123456789abcdef0123456789abcdef012345",
      expiresAt: "2028-08-15",
      warrantyDaysRemaining: 630,
      claimsUsed: 1,
    };

    const svg = buildCertificateSvg(certData);
    expect(svg).toContain("<svg");
    expect(svg).toContain("Certificate of Authenticity &amp; Warranty");
    expect(svg).toContain(certData.ownerAddress);
    expect(svg).toContain(certData.txHash);
    expect(svg).toContain(certData.expiresAt);
    expect(svg).toContain("<path d=");

    const pdfBytes = buildCertificatePdfBytes(certData);
    const pdfText = new TextDecoder().decode(pdfBytes);
    expect(pdfText.startsWith("%PDF-1.4")).toBe(true);
    expect(pdfText.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(pdfText).toContain(certData.ownerAddress);
    expect(pdfText).toContain(certData.txHash);
    expect(pdfText).toContain(certData.expiresAt);
  });

  it("resolves GS1 Digital Link GTIN/serial paths and rejects invalid GTINs", async () => {
    expect(isValidGtinFormat("01234567890128")).toBe(true);
    expect(isValidGtinFormat("12345678")).toBe(true);
    expect(isValidGtinFormat("INVALID-GTIN")).toBe(false);

    const invalid = await resolveGs1DigitalLink("ABC", "CH-2026-000101");
    expect(invalid).toBeNull();

    const fallbackResolved = await resolveGs1DigitalLink("01234567890128", "CH-2026-000101");
    expect(fallbackResolved).not.toBeNull();
    expect(fallbackResolved?.source).toBe("demo-fallback");
    expect(fallbackResolved?.redirectPath).toContain("/v/");
    expect(fallbackResolved?.redirectPath).toContain("/CH-2026-000101");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          brandAddress: "GABC1234567890BRAND",
          brandDomain: "atelier.example",
          batchId: "batch-999",
        }),
      }),
    );

    const apiResolved = await resolveGs1DigitalLink("01234567890128", "SER-42");
    expect(apiResolved?.source).toBe("api");
    expect(apiResolved?.brandDomain).toBe("atelier.example");
    expect(apiResolved?.redirectPath).toBe("/v/GABC1234567890BRAND/batch-999/SER-42");
  });
});
