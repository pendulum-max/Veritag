import { IndexerPoller, RpcEventsProvider } from "./poller.js";
import { InMemoryIndexerWriter, PostgresIndexerWriter } from "./writer.js";

const rpcUrl = process.env.SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
const contractId =
  process.env.REGISTRY_CONTRACT_ID ?? "CCOY35YSS7ICXGYOSZOF4QXZP5OG2MFSEFXZUYJEFUUXG5HHZ3ZUZQND";
const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://veritag:veritag@localhost:5432/veritag";
const pollIntervalMs = Number(process.env.INDEXER_POLL_INTERVAL_MS ?? 5000);
const confirmationLedgers = Number(process.env.INDEXER_CONFIRMATION_LEDGERS ?? 2);

const writer =
  process.env.USE_IN_MEMORY_DB === "true"
    ? new InMemoryIndexerWriter()
    : new PostgresIndexerWriter(databaseUrl);

const provider = new RpcEventsProvider(rpcUrl);
const poller = new IndexerPoller({
  contractId,
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

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.backfill) {
    if (!args.fromLedger || !args.toLedger) {
      console.error("Usage: veritag-indexer --backfill --from <startLedger> --to <endLedger>");
      process.exit(1);
    }
    console.log(
      `[indexer] Running backfill for ${contractId} from ledger ${args.fromLedger} to ${args.toLedger}...`,
    );
    const summary = await poller.backfillRange(args.fromLedger, args.toLedger);
    console.log(
      `[indexer] Backfill complete: pages=${summary.pages} fetched=${summary.fetched} applied=${summary.applied}`,
    );
    return;
  }

  console.log(`Veritag indexer started for contract ${contractId} via ${rpcUrl}`);
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
