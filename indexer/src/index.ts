import { IndexerPoller, RpcEventsProvider } from "./poller.js";
import { InMemoryIndexerWriter, PostgresIndexerWriter } from "./writer.js";

const rpcUrl = process.env.SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
const contractId =
  process.env.REGISTRY_CONTRACT_ID ?? "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
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

async function runLoop(): Promise<void> {
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
  void runLoop();
}
