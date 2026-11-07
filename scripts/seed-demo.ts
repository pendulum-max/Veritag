import { Keypair } from "@stellar/stellar-sdk";
import { createApp } from "../backend/src/app.js";
import { loadConfig } from "../backend/src/config.js";
import { InMemoryRepository } from "../backend/src/db/repository.js";

async function seedDemo(): Promise<void> {
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  const webBase = process.env.APP_BASE_URL ?? "http://localhost:3000";

  // Detect whether a live backend server is reachable; otherwise run against an in-process app
  let liveServer = false;
  try {
    const health = await fetch(`${apiBase}/health`);
    liveServer = health.ok;
  } catch {
    liveServer = false;
  }

  const repo = new InMemoryRepository();
  const config = loadConfig();
  const localApp = createApp({ config, repo });

  const request = async (path: string, init?: RequestInit): Promise<Response> => {
    if (liveServer) {
      return fetch(`${apiBase}${path}`, init);
    }
    return localApp.request(path, init);
  };

  const brandKp = Keypair.random();
  const buyerKp = Keypair.random();

  // 1. Authenticate demo brand via SEP-10 challenge
  const chRes = await request("/v1/auth/challenge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account: brandKp.publicKey() }),
  });
  const challenge = (await chRes.json()) as { nonce: string; message: string };
  const sigHex = Buffer.from(brandKp.sign(Buffer.from(challenge.message, "utf8"))).toString("hex");

  const verRes = await request("/v1/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nonce: challenge.nonce, signature: sigHex }),
  });
  const { token } = (await verRes.json()) as { token: string };

  // 2. Register verified demo brand
  await request("/v1/brands/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ domain: "chronos-watches.swiss", verified: true }),
  });

  // 3. Commit a 1,000-unit Merkle production batch
  const batchRes = await request("/v1/brands/batches", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      batchCode: "DEMO-2026-THOUSAND",
      warrantyMonths: 24,
      productMeta: {
        brand: "Chronos Genève",
        model: "Calibre S1 Automatic",
        origin: "Switzerland",
      },
      count: 1000,
    }),
  });

  const { batch } = (await batchRes.json()) as {
    batch: { batchId: string; merkleRoot: string; unitCount: number };
  };

  // 4. Export print manifest and activate Unit #1 to showcase both unclaimed & claimed QR states
  const exportRes = await request(`/v1/brands/batches/${batch.batchId}/export`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const exported = (await exportRes.json()) as {
    units: Array<{ unitId: string; serial: string; scratchSecret: string; qrUrl: string }>;
  };

  const firstUnit = exported.units[0]!;
  const secondUnit = exported.units[1]!;

  await request("/v1/activate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      brand: brandKp.publicKey(),
      batchId: batch.batchId,
      serial: firstUnit.serial,
      secret: firstUnit.scratchSecret,
      firstOwner: buyerKp.publicKey(),
    }),
  });

  console.log("==================================================================");
  console.log(`Veritag Demo Seed Complete (${liveServer ? "Live Backend" : "Standalone Mode"})`);
  console.log("==================================================================");
  console.log(`Brand Account : ${brandKp.publicKey()}`);
  console.log(`Batch ID      : ${batch.batchId}`);
  console.log(`Merkle Root   : ${batch.merkleRoot}`);
  console.log(`Total Units   : ${batch.unitCount.toLocaleString()}`);
  console.log("");
  console.log("Sample QR Verification Links:");
  console.log(
    `  1) Activated Unit : ${webBase}/v/${brandKp.publicKey()}/${batch.batchId}/${firstUnit.serial}`,
  );
  console.log(
    `  2) Unclaimed Unit : ${webBase}/v/${brandKp.publicKey()}/${batch.batchId}/${secondUnit.serial}`,
  );
  console.log(`     Scratch Secret : ${secondUnit.scratchSecret}`);
  console.log("==================================================================");
}

seedDemo().catch((err: unknown) => {
  console.error("Failed to seed demo data:", err);
  process.exit(1);
});
