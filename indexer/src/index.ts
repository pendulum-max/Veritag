import { createServer, type Server } from "node:http";
import { AlertService } from "./alerts.js";
import type { ContractKind } from "./decoder.js";
import { IndexerPoller, RpcEventsProvider } from "./poller.js";
import { InMemoryIndexerWriter, PostgresIndexerWriter } from "./writer.js";

const rpcUrl = process.env.SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
const registryContractId =
  process.env.REGISTRY_CONTRACT_ID ?? "CCOY35YSS7ICXGYOSZOF4QXZP5OG2MFSEFXZUYJEFUUXG5HHZ3ZUZQND";
const accountFactoryContractId = process.env.ACCOUNT_FACTORY_CONTRACT_ID;
const passkeyAccountContractIds = (process.env.PASSKEY_ACCOUNT_CONTRACT_IDS ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const extraContractIds = (process.env.INDEXER_CONTRACT_IDS ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

const contractKinds: Record<string, ContractKind> = {
  [registryContractId]: "registry",
};
if (accountFactoryContractId) {
  contractKinds[accountFactoryContractId] = "account_factory";
}
for (const id of passkeyAccountContractIds) {
  contractKinds[id] = "passkey_account";
}

const contractIds = Array.from(
  new Set([
    registryContractId,
    ...(accountFactoryContractId ? [accountFactoryContractId] : []),
    ...passkeyAccountContractIds,
    ...extraContractIds,
  ]),
);

const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://veritag:veritag@localhost:5432/veritag";
const pollIntervalMs = Number(process.env.INDEXER_POLL_INTERVAL_MS ?? 5000);
const confirmationLedgers = Number(process.env.INDEXER_CONFIRMATION_LEDGERS ?? 2);
const healthPort = Number(process.env.INDEXER_HEALTH_PORT ?? process.env.PORT ?? 8080);
const maxAllowedLag = Number(process.env.MAX_ALLOWED_LAG ?? 50);

const alertService = new AlertService();

const writer =
  process.env.USE_IN_MEMORY_DB === "true"
    ? new InMemoryIndexerWriter(alertService)
    : new PostgresIndexerWriter(databaseUrl, alertService);

const provider = new RpcEventsProvider(rpcUrl);
const poller = new IndexerPoller({
  contractIds,
  contractKinds,
  provider,
  writer,
  confirmationLedgers,
});

export function parseCliArgs(argv: readonly string[]): {
  backfill: boolean;
  fromLedger?: number;
  toLedger?: number;
} {
  const backfill = argv.includes("--backfill");
  const fromIdx = argv.indexOf("--from");
  const toIdx = argv.indexOf("--to");
  const fromLedger =
    fromIdx !== -1 && argv[fromIdx + 1] ? Number(argv[fromIdx + 1]) : undefined;
  const toLedger = toIdx !== -1 && argv[toIdx + 1] ? Number(argv[toIdx + 1]) : undefined;
  return { backfill, fromLedger, toLedger };
}

/**
 * Creates a lightweight HTTP server exposing `GET /healthz` for container liveness/readiness checks.
 */
export function createHealthServer(
  targetPoller: IndexerPoller,
  maxLag = maxAllowedLag,
): Server {
  return createServer((req, res) => {
    const urlPath = (req.url ?? "/").split("?")[0];
    if (req.method === "GET" && urlPath === "/healthz") {
      const health = targetPoller.getHealthStatus(maxLag);
      const statusCode = health.status === "healthy" ? 200 : 503;
      res.writeHead(statusCode, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: health.status, lag: health.lag }));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.backfill) {
    if (!args.fromLedger || !args.toLedger) {
      console.error("Usage: veritag-indexer --backfill --from <startLedger> --to <endLedger>");
      process.exit(1);
    }
    console.log(
      `[indexer] Running backfill for ${contractIds.join(", ")} from ledger ${args.fromLedger} to ${args.toLedger}...`,
    );
    const summary = await poller.backfillRange(args.fromLedger, args.toLedger);
    console.log(
      `[indexer] Backfill complete: pages=${summary.pages} fetched=${summary.fetched} applied=${summary.applied}`,
    );
    return;
  }

  const healthServer = createHealthServer(poller, maxAllowedLag);
  healthServer.listen(healthPort, () => {
    console.log(`[indexer] Healthcheck listening on :${healthPort}/healthz (MAX_ALLOWED_LAG=${maxAllowedLag})`);
  });

  console.log(`Veritag indexer started for contracts ${contractIds.join(", ")} via ${rpcUrl}`);
  while (true) {
    try {
      const stats = await poller.pollOnce();
      if (stats.fetched > 0 || stats.finalized > 0) {
        console.log(
          `[indexer] fetched=${stats.fetched} applied=${stats.applied} finalized=${stats.finalized}`,
        );
      }
    } catch (err) {
      console.error("[indexer] poll cycle error:", err);
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
