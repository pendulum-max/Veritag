import { generateKeyPairSync, sign } from "node:crypto";
import { rmSync } from "node:fs";
import { Keypair } from "@stellar/stellar-sdk";
import { extractP256UncompressedPublicKey, parseVerifyPath } from "@veritag/sdk";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { JsonFileRepository } from "../src/db/repository.js";
import { LocalDiskObjectStorage } from "../src/services/storage.js";

async function authenticateEd25519(app: ReturnType<typeof createApp>, kp: Keypair): Promise<string> {
  const chRes = await app.request("/v1/auth/challenge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account: kp.publicKey() }),
  });
  const challenge = (await chRes.json()) as { nonce: string; message: string };
  const signature = Buffer.from(kp.sign(Buffer.from(challenge.message, "utf8"))).toString("hex");
  const verRes = await app.request("/v1/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nonce: challenge.nonce, signature }),
  });
  const { token } = (await verRes.json()) as { token: string };
  return token;
}

async function createAndAuthPasskeyConsumer(
  app: ReturnType<typeof createApp>,
  credentialId: string,
): Promise<{ walletAddress: string; token: string }> {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const spkiDer = publicKey.export({ format: "der", type: "spki" });
  const sec1Hex = extractP256UncompressedPublicKey(spkiDer).toString("hex");

  const regRes = await app.request("/v1/wallets/passkey", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credentialId, publicKeyHex: sec1Hex }),
  });
  expect(regRes.status).toBe(201);
  const { wallet } = (await regRes.json()) as {
    wallet: { walletAddress: string };
  };

  const chRes = await app.request("/v1/auth/challenge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account: wallet.walletAddress }),
  });
  const challenge = (await chRes.json()) as { nonce: string; message: string };

  const sig = sign("sha256", Buffer.from(challenge.message, "utf8"), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });

  const verRes = await app.request("/v1/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nonce: challenge.nonce,
      signature: sig.toString("hex"),
      passkeyAssertion: { publicKeyHex: sec1Hex },
    }),
  });
  expect(verRes.status).toBe(200);
  const { token } = (await verRes.json()) as { token: string };
  return { walletAddress: wallet.walletAddress, token };
}

describe("Full-Stack E2E Lifecycle (Brand + Passkey Consumers + Service Center)", () => {
  it("executes end-to-end lifecycle with JsonFileRepository and LocalDiskObjectStorage", async () => {
    const tmpDir = `.data/e2e-${Date.now()}`;
    const dbFile = `${tmpDir}/db.json`;
    const storageDir = `${tmpDir}/storage`;

    const brandKp = Keypair.random();
    const serviceKp = Keypair.random();

    const repo = new JsonFileRepository(dbFile);
    const storage = new LocalDiskObjectStorage(storageDir, "veritag-e2e");
    const config = loadConfig({});

    const mockTomlFetch: typeof fetch = async () =>
      new Response(`SIGNING_KEY="${brandKp.publicKey()}"\n`, { status: 200 });

    const app = createApp({ config, repo, storage, tomlFetch: mockTomlFetch });

    try {
      // 1. Brand & Service Center authenticate via Ed25519
      const brandToken = await authenticateEd25519(app, brandKp);
      const serviceToken = await authenticateEd25519(app, serviceKp);

      // 2. Brand registers & verifies domain via stellar.toml, then authorizes service center
      await app.request("/v1/brands/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${brandToken}`,
        },
        body: JSON.stringify({ domain: "omega-precision.ch" }),
      });

      const domVerRes = await app.request("/v1/brands/verify-domain", {
        method: "POST",
        headers: { Authorization: `Bearer ${brandToken}` },
      });
      expect(domVerRes.status).toBe(200);

      await app.request("/v1/brands/service-centers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${brandToken}`,
        },
        body: JSON.stringify({ serviceCenter: serviceKp.publicKey(), authorized: true }),
      });

      // 3. Brand creates production batch & exports QR SVG labels with secret purge
      const batchRes = await app.request("/v1/brands/batches", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${brandToken}`,
        },
        body: JSON.stringify({
          batchCode: "OMEGA-2026-E2E",
          warrantyMonths: 36,
          productMeta: { model: "Seamaster Co-Axial" },
          count: 8,
        }),
      });
      expect(batchRes.status).toBe(201);
      const { batch } = (await batchRes.json()) as { batch: { batchId: string } };

      const exportRes = await app.request(
        `/v1/brands/batches/${batch.batchId}/export?purge=true`,
        {
          headers: { Authorization: `Bearer ${brandToken}` },
        },
      );
      expect(exportRes.status).toBe(200);
      const exported = (await exportRes.json()) as {
        units: Array<{
          unitId: string;
          serial: string;
          scratchSecret: string;
          qrUrl: string;
          qrSvg: string;
        }>;
      };
      const tag0 = exported.units[0]!;
      expect(tag0.qrSvg).toContain("data-qr-payload=");

      // Parse the QR URL + `#s=<secret>` fragment just as the mobile scanner does
      const parsedUrl = new URL(tag0.qrUrl);
      const pathParts = parseVerifyPath(parsedUrl.pathname)!;
      const hashSecret = decodeURIComponent(parsedUrl.hash.slice(3));
      expect(hashSecret).toBe(tag0.scratchSecret);

      // 4. Consumer Alice deploys Passkey Smart Wallet (C...) & activates unit
      const alice = await createAndAuthPasskeyConsumer(app, "alice-passkey-01");
      const bob = await createAndAuthPasskeyConsumer(app, "bob-passkey-02");

      const actRes = await app.request("/v1/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand: pathParts.brand,
          batchId: pathParts.batch,
          serial: pathParts.serial,
          secret: hashSecret,
          firstOwner: alice.walletAddress,
        }),
      });
      expect(actRes.status).toBe(201);

      // 5. Alice transfers ownership to Bob's Passkey Smart Wallet
      const offerRes = await app.request("/v1/transfer/offer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${alice.token}`,
        },
        body: JSON.stringify({ unitId: tag0.unitId, ttlSeconds: 3600 }),
      });
      const { transferCode } = (await offerRes.json()) as { transferCode: string };

      const redeemRes = await app.request("/v1/transfer/redeem", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bob.token}`,
        },
        body: JSON.stringify({ unitId: tag0.unitId, code: transferCode }),
      });
      expect(redeemRes.status).toBe(200);

      // Verify Bob's owner portal lists the transferred unit
      const bobUnitsRes = await app.request(`/v1/owners/${bob.walletAddress}/units`, {
        headers: { Authorization: `Bearer ${bob.token}` },
      });
      const bobUnits = (await bobUnitsRes.json()) as { units: Array<{ unitId: string }> };
      expect(bobUnits.units.map((u) => u.unitId)).toContain(tag0.unitId);

      // 6. Bob files warranty claim -> Service center uploads diagnostic report & resolves
      const claimRes = await app.request("/v1/claims", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bob.token}`,
        },
        body: JSON.stringify({
          unitId: tag0.unitId,
          serviceCenter: serviceKp.publicKey(),
        }),
      });
      expect(claimRes.status).toBe(201);

      const uploadRes = await app.request("/v1/files", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceToken}`,
        },
        body: JSON.stringify({
          contentBase64: Buffer.from("Pressure test passed at 30 bar").toString("base64"),
          mime: "text/plain",
        }),
      });
      const { hash: reportHash } = (await uploadRes.json()) as { hash: string };

      const resolveRes = await app.request("/v1/claims/1/resolve", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceToken}`,
        },
        body: JSON.stringify({
          unitId: tag0.unitId,
          outcome: "Repaired",
          reportHash,
        }),
      });
      expect(resolveRes.status).toBe(200);

      // Verify disk persistence by instantiating a fresh JsonFileRepository from the same file
      const reloadedRepo = new JsonFileRepository(dbFile);
      const persistedUnit = await reloadedRepo.getUnit(tag0.unitId);
      expect(persistedUnit?.owner).toBe(bob.walletAddress);
      expect(persistedUnit?.claimsUsed).toBe(1);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
