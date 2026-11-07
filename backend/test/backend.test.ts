import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { InMemoryRepository } from "../src/db/repository.js";
import { SlidingWindowRateLimiter } from "../src/services/auth.js";
import { StellarFeeSponsorService } from "../src/services/relayer.js";

async function authenticateKeypair(app: ReturnType<typeof createApp>, kp: Keypair): Promise<string> {
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

    // 4. Export print line secrets & QR URLs, then purge raw secrets
    const exportCsvRes = await app.request(`/v1/brands/batches/${batch.batchId}/export?format=csv`, {
      headers: { Authorization: `Bearer ${brandToken}` },
    });
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
        proof: string[];
      }>;
    };
    expect(exported.secretsPurged).toBe(true);

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

    // 8. Bob files warranty claim -> Service center uploads report & resolves
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

    const fileRes = await app.request("/v1/files", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${scToken}`,
      },
      body: JSON.stringify({
        contentBase64: Buffer.from("Service Diagnostics Report: Passed Gasket Seal").toString(
          "base64",
        ),
        mime: "text/plain",
      }),
    });
    expect(fileRes.status).toBe(201);
    const { hash: reportHash } = (await fileRes.json()) as { hash: string };

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
      body: JSON.stringify({ innerTxXdr: footprintTx.toXDR() }),
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
