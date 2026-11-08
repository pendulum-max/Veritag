import { generateKeyPairSync, sign } from "node:crypto";
import { rmSync } from "node:fs";
import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { extractP256UncompressedPublicKey } from "@veritag/sdk";
import type pg from "pg";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { InMemoryRepository, PostgresRepository } from "../src/db/repository.js";
import { SlidingWindowRateLimiter } from "../src/services/auth.js";
import { StellarFeeSponsorService } from "../src/services/relayer.js";
import { isSafePublicDomain } from "../src/services/stellar-toml.js";
import { LocalDiskObjectStorage } from "../src/services/storage.js";

async function authenticateKeypair(
  app: ReturnType<typeof createApp>,
  kp: Keypair,
): Promise<string> {
  const chRes = await app.request("/v1/auth/challenge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account: kp.publicKey() }),
  });
  expect(chRes.status).toBe(200);
  const challenge = (await chRes.json()) as { nonce: string; message: string };

  const signature = Buffer.from(kp.sign(Buffer.from(challenge.message, "utf8"))).toString("hex");
  const verRes = await app.request("/v1/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nonce: challenge.nonce, signature }),
  });
  expect(verRes.status).toBe(200);
  const { token } = (await verRes.json()) as { token: string };
  return token;
}

describe("@veritag/backend API & services", () => {
  it("runs complete batch -> export -> verify -> activate -> transfer -> claim -> recall flow", async () => {
    const sponsorKp = Keypair.random();
    const brandKp = Keypair.random();
    const serviceCenterKp = Keypair.random();
    const aliceKp = Keypair.random();
    const bobKp = Keypair.random();

    const config = {
      ...loadConfig({}),
      sponsorSecret: sponsorKp.secret(),
      jwtSecret: "test-jwt-secret-key",
    };
    const repo = new InMemoryRepository();
    const app = createApp({ config, repo });

    // 1. Authenticate brand, service center, Alice, and Bob
    const brandToken = await authenticateKeypair(app, brandKp);
    const scToken = await authenticateKeypair(app, serviceCenterKp);
    const aliceToken = await authenticateKeypair(app, aliceKp);
    const bobToken = await authenticateKeypair(app, bobKp);

    // 2. Register verified brand & authorize service center
    await repo.upsertBrand({
      address: brandKp.publicKey(),
      admin: brandKp.publicKey(),
      domain: "chronos-watches.swiss",
      verified: true,
      createdAt: new Date().toISOString(),
    });

    const scRegRes = await app.request("/v1/brands/service-centers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${brandToken}`,
      },
      body: JSON.stringify({ serviceCenter: serviceCenterKp.publicKey(), authorized: true }),
    });
    expect(scRegRes.status).toBe(200);

    // 3. Create production batch of 4 units
    const batchRes = await app.request("/v1/brands/batches", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${brandToken}`,
      },
      body: JSON.stringify({
        batchCode: "CH-2026-LOT1",
        warrantyMonths: 24,
        productMeta: { model: "Chronos Titan", sku: "CT-01" },
        count: 4,
      }),
    });
    expect(batchRes.status).toBe(201);
    const { batch } = (await batchRes.json()) as {
      batch: { batchId: string; merkleRoot: string; unitCount: number };
    };
    expect(batch.unitCount).toBe(4);

    // 4. Export print line secrets & QR SVG/URLs, then purge raw secrets
    const exportCsvRes = await app.request(
      `/v1/brands/batches/${batch.batchId}/export?format=csv`,
      {
        headers: { Authorization: `Bearer ${brandToken}` },
      },
    );
    expect(exportCsvRes.status).toBe(200);
    expect(await exportCsvRes.text()).toContain("unit_id,serial,scratch_secret,qr_url");

    const exportJsonRes = await app.request(
      `/v1/brands/batches/${batch.batchId}/export?purge=true`,
      {
        headers: { Authorization: `Bearer ${brandToken}` },
      },
    );
    expect(exportJsonRes.status).toBe(200);
    const exported = (await exportJsonRes.json()) as {
      secretsPurged: boolean;
      units: Array<{
        unitId: string;
        serial: string;
        scratchSecret: string;
        qrSvg?: string;
        qrDataUrl?: string;
        proof: string[];
      }>;
    };
    expect(exported.secretsPurged).toBe(true);
    expect(exported.units[0]?.qrSvg).toContain("<svg");
    expect(exported.units[0]?.qrDataUrl?.startsWith("data:image/svg+xml;base64,")).toBe(true);

    // Second export fails with 410 Gone because secrets were purged after printing
    const secondExport = await app.request(`/v1/brands/batches/${batch.batchId}/export`, {
      headers: { Authorization: `Bearer ${brandToken}` },
    });
    expect(secondExport.status).toBe(410);

    const unit0 = exported.units[0]!;

    // 5. Public verify: Unknown serial vs AuthenticInactive
    const unknownRes = await app.request(
      `/v1/verify/${brandKp.publicKey()}/${batch.batchId}/FAKE-SERIAL-999`,
    );
    expect(((await unknownRes.json()) as { status: string }).status).toBe("Unknown");

    const inactiveRes = await app.request(
      `/v1/verify/${brandKp.publicKey()}/${batch.batchId}/${unit0.serial}`,
    );
    const inactiveBody = (await inactiveRes.json()) as { status: string; scanCount: number };
    expect(inactiveBody.status).toBe("AuthenticInactive");
    expect(inactiveBody.scanCount).toBe(1);

    // 6. Activate unit 0 for Alice; second activation flags duplicate attempt!
    const actRes = await app.request("/v1/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brand: brandKp.publicKey(),
        batchId: batch.batchId,
        serial: unit0.serial,
        secret: unit0.scratchSecret,
        firstOwner: aliceKp.publicKey(),
      }),
    });
    expect(actRes.status).toBe(201);

    const dupActRes = await app.request("/v1/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brand: brandKp.publicKey(),
        batchId: batch.batchId,
        serial: unit0.serial,
        secret: unit0.scratchSecret,
        firstOwner: bobKp.publicKey(),
      }),
    });
    expect(dupActRes.status).toBe(409);

    const verifyAfterDup = await app.request(
      `/v1/verify/${brandKp.publicKey()}/${batch.batchId}/${unit0.serial}`,
    );
    expect(((await verifyAfterDup.json()) as { status: string }).status).toBe(
      "AlreadyClaimedWarning",
    );

    // 7. Resale transfer from Alice -> Bob
    const offerRes = await app.request("/v1/transfer/offer", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({ unitId: unit0.unitId, ttlSeconds: 3600 }),
    });
    expect(offerRes.status).toBe(200);
    const { transferCode } = (await offerRes.json()) as { transferCode: string };

    const redeemRes = await app.request("/v1/transfer/redeem", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${bobToken}`,
      },
      body: JSON.stringify({ unitId: unit0.unitId, code: transferCode }),
    });
    expect(redeemRes.status).toBe(200);

    // 8. Bob files warranty claim -> Service center uploads report, downloads it, & resolves
    const claimRes = await app.request("/v1/claims", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${bobToken}`,
      },
      body: JSON.stringify({
        unitId: unit0.unitId,
        serviceCenter: serviceCenterKp.publicKey(),
      }),
    });
    expect(claimRes.status).toBe(201);
    const { claimId } = (await claimRes.json()) as { claimId: number };

    const reportText = "Service Diagnostics Report: Passed Gasket Seal";
    const fileRes = await app.request("/v1/files", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${scToken}`,
      },
      body: JSON.stringify({
        contentBase64: Buffer.from(reportText).toString("base64"),
        mime: "text/plain",
      }),
    });
    expect(fileRes.status).toBe(201);
    const { hash: reportHash } = (await fileRes.json()) as { hash: string };

    const downloadRes = await app.request(`/v1/files/${reportHash}`);
    expect(downloadRes.status).toBe(200);
    expect(downloadRes.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await downloadRes.text()).toBe(reportText);

    const resolveRes = await app.request(`/v1/claims/${claimId}/resolve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${scToken}`,
      },
      body: JSON.stringify({
        unitId: unit0.unitId,
        outcome: "Repaired",
        reportHash,
      }),
    });
    expect(resolveRes.status).toBe(200);

    // Run TTL maintenance sweep while batch & unit are active
    const sweepRes = await app.request("/v1/maintenance/ttl-sweep", {
      method: "POST",
      headers: { Authorization: `Bearer ${brandToken}` },
    });
    expect(sweepRes.status).toBe(200);
    const sweepBody = (await sweepRes.json()) as {
      batchesBumped: number;
      unitsBumped: number;
    };
    expect(sweepBody.batchesBumped).toBe(1);
    expect(sweepBody.unitsBumped).toBe(1);

    // Timeline check
    const timelineRes = await app.request(`/v1/units/${unit0.unitId}`);
    const timelineBody = (await timelineRes.json()) as {
      timeline: Array<{ type: string }>;
      claims: Array<{ outcome: string }>;
    };
    expect(timelineBody.claims[0]?.outcome).toBe("Repaired");
    expect(timelineBody.timeline.map((e) => e.type)).toEqual([
      "unit_activated",
      "duplicate_attempt",
      "transfer_offered",
      "unit_transferred",
      "claim_filed",
      "claim_resolved",
    ]);

    // 9. Recall batch turns verify page red immediately
    const recallRes = await app.request("/v1/brands/recall", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${brandToken}`,
      },
      body: JSON.stringify({
        mode: "batch",
        batchId: batch.batchId,
        reason: "Crown gasket defect recall",
      }),
    });
    expect(recallRes.status).toBe(200);

    const recalledVerify = await app.request(
      `/v1/verify/${brandKp.publicKey()}/${batch.batchId}/${unit0.serial}`,
    );
    expect(((await recalledVerify.json()) as { status: string }).status).toBe("Recalled");
  });

  it("verifies brand domain via stellar.toml and blocks SSRF domains", async () => {
    expect(isSafePublicDomain("chronos-watches.swiss")).toBe(true);
    expect(isSafePublicDomain("localhost")).toBe(false);
    expect(isSafePublicDomain("127.0.0.1")).toBe(false);
    expect(isSafePublicDomain("192.168.1.10")).toBe(false);
    expect(isSafePublicDomain("169.254.169.254")).toBe(false);

    const brandKp = Keypair.random();
    const repo = new InMemoryRepository();
    const mockTomlFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url === "https://chronos-watches.swiss/.well-known/stellar.toml") {
        return new Response(
          `VERSION="2.0.0"\nSIGNING_KEY="${brandKp.publicKey()}"\nACCOUNTS=["${brandKp.publicKey()}"]\n`,
          { status: 200 },
        );
      }
      return new Response("Not Found", { status: 404 });
    };

    const app = createApp({ repo, tomlFetch: mockTomlFetch });
    const brandToken = await authenticateKeypair(app, brandKp);

    const regRes = await app.request("/v1/brands/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${brandToken}`,
      },
      body: JSON.stringify({ domain: "chronos-watches.swiss" }),
    });
    expect(regRes.status).toBe(201);

    const verRes = await app.request("/v1/brands/verify-domain", {
      method: "POST",
      headers: { Authorization: `Bearer ${brandToken}` },
    });
    expect(verRes.status).toBe(200);
    const verBody = (await verRes.json()) as { verified: boolean; matchedField: string };
    expect(verBody.verified).toBe(true);
    expect(verBody.matchedField).toBe("SIGNING_KEY");

    const meRes = await app.request("/v1/brands/me", {
      headers: { Authorization: `Bearer ${brandToken}` },
    });
    const meBody = (await meRes.json()) as { brand: { verified: boolean } };
    expect(meBody.brand.verified).toBe(true);
  });

  it("deploys deterministic passkey smart wallet and authenticates via P-256 signature", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const spkiDer = publicKey.export({ format: "der", type: "spki" });
    const uncompressedKey = extractP256UncompressedPublicKey(spkiDer);

    const tmpStorageDir = `.data/test-storage-${Date.now()}`;
    const storage = new LocalDiskObjectStorage(tmpStorageDir, "veritag-test");
    const app = createApp({ storage });

    try {
      const createRes = await app.request("/v1/wallets/passkey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credentialId: "passkey-cred-consumer-01",
          publicKeyHex: uncompressedKey.toString("hex"),
        }),
      });
      expect(createRes.status).toBe(201);
      const { wallet } = (await createRes.json()) as {
        wallet: { walletAddress: string; publicKeyHex: string };
      };
      expect(wallet.walletAddress.startsWith("C")).toBe(true);

      // Lookup by credential ID returns the exact same deterministic C... address
      const getRes = await app.request("/v1/wallets/passkey/passkey-cred-consumer-01");
      expect(getRes.status).toBe(200);

      // Authenticate the C... smart account via /v1/auth/challenge & /v1/auth/verify with P-256 signature
      const chRes = await app.request("/v1/auth/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: wallet.walletAddress }),
      });
      expect(chRes.status).toBe(200);
      const challenge = (await chRes.json()) as { nonce: string; message: string };

      const p256Sig = sign(
        "sha256",
        Buffer.from(challenge.message, "utf8"),
        { key: privateKey, dsaEncoding: "ieee-p1363" },
      );

      const verRes = await app.request("/v1/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nonce: challenge.nonce,
          signature: p256Sig.toString("hex"),
          passkeyAssertion: {
            publicKeyHex: uncompressedKey.toString("hex"),
          },
        }),
      });
      expect(verRes.status).toBe(200);
    } finally {
      rmSync(tmpStorageDir, { recursive: true, force: true });
    }
  });

  it("executes parameterized SQL queries in PostgresRepository", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const mockPool = {
      query: async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        if (sql.includes("FROM transfer_offers")) {
          return {
            rows: [{ unit_id: "u1", code_hash: "ch1", expires_at: 999999 }],
          };
        }
        if (sql.includes("FROM passkey_wallets")) {
          return {
            rows: [
              {
                credential_id: "cred1",
                wallet_address: "CABC",
                public_key_hex: "04" + "11".repeat(64),
                salt_hex: "22".repeat(32),
                recovery_address: null,
                deployed: true,
                created_at: new Date().toISOString(),
              },
            ],
          };
        }
        return { rows: [] };
      },
      end: async () => {},
    } as unknown as pg.Pool;

    const pgRepo = new PostgresRepository(mockPool);
    await pgRepo.setTransferOffer({ unitId: "u1", codeHash: "ch1", expiresAt: 999999 });
    const offer = await pgRepo.getTransferOffer("u1");
    expect(offer?.codeHash).toBe("ch1");

    await pgRepo.upsertPasskeyWallet({
      credentialId: "cred1",
      walletAddress: "CABC",
      publicKeyHex: "04" + "11".repeat(64),
      saltHex: "22".repeat(32),
      recoveryAddress: null,
      deployed: true,
      createdAt: new Date().toISOString(),
    });
    const pw = await pgRepo.getPasskeyWallet("cred1");
    expect(pw?.walletAddress).toBe("CABC");
    expect(queries.length).toBe(4);
  });

  it("enforces rate limiting and blocks non-Soroban operations on fee sponsor", async () => {
    const sponsorKp = Keypair.random();
    const userKp = Keypair.random();
    const limiter = new SlidingWindowRateLimiter(2, 60_000);
    const relayer = new StellarFeeSponsorService({
      sponsorSecret: sponsorKp.secret(),
      networkPassphrase: Networks.TESTNET,
      quota: { maxStroopsPerUserWindow: 25_000 },
    });

    const app = createApp({
      config: { ...loadConfig({}), sponsorSecret: sponsorKp.secret() },
      rateLimiter: limiter,
      relayer,
    });
    const userToken = await authenticateKeypair(app, userKp);

    // Non-Soroban XLM payment transaction must be rejected by fee sponsor!
    const source = new Account(userKp.publicKey(), "100");
    const paymentTx = new TransactionBuilder(source, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({
          destination: sponsorKp.publicKey(),
          asset: Asset.native(),
          amount: "10",
        }),
      )
      .setTimeout(60)
      .build();
    paymentTx.sign(userKp);

    const badSponsorRes = await app.request("/v1/sponsor", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ innerTxXdr: paymentTx.toXDR() }),
    });
    expect(badSponsorRes.status).toBe(400);
    expect(((await badSponsorRes.json()) as { error: string }).error).toBe(
      "UnsupportedSponsoredOperation",
    );

    // Valid restoreFootprint Soroban maintenance tx is sponsored until quota/rate limit triggers
    const footprintTx = new TransactionBuilder(source, {
      fee: "1000",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.restoreFootprint({}))
      .setTimeout(60)
      .build();
    footprintTx.sign(userKp);

    const okSponsorRes = await app.request("/v1/sponsor", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ innerTxXdr: footprintTx.toXDR(), submit: true }),
    });
    expect(okSponsorRes.status).toBe(200);

    // 3rd request within 1 minute hits SlidingWindowRateLimiter (limit = 2)
    const rateLimitedRes = await app.request("/v1/sponsor", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ innerTxXdr: footprintTx.toXDR() }),
    });
    expect(rateLimitedRes.status).toBe(429);
  });
});
