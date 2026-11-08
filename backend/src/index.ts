import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import {
  InMemoryRepository,
  JsonFileRepository,
  PostgresRepository,
  type Repository,
} from "./db/repository.js";
import { SorobanTransactionService } from "./services/soroban-tx.js";
import { LocalDiskObjectStorage, S3CompatibleObjectStorage } from "./services/storage.js";
import { TtlMaintenanceWorker } from "./services/ttl-worker.js";

const config = loadConfig();

function selectRepository(): Repository {
  if (process.env.USE_IN_MEMORY_DB === "true") {
    return new InMemoryRepository();
  }
  if (process.env.USE_POSTGRES_DB === "true") {
    return new PostgresRepository(config.databaseUrl);
  }
  return new JsonFileRepository(".data/veritag-db.json");
}

const repo = selectRepository();
const storage =
  process.env.USE_S3_STORAGE === "true"
    ? new S3CompatibleObjectStorage({
        endpoint: config.s3Endpoint,
        bucket: config.s3Bucket,
        localFallbackDir: config.localStorageDir,
      })
    : new LocalDiskObjectStorage(config.localStorageDir, config.s3Bucket);

const sorobanTx = new SorobanTransactionService(config);
const ttlWorker = new TtlMaintenanceWorker({ config, repo, sorobanTx });
ttlWorker.start();

const app = createApp({ config, repo, storage, sorobanTx, ttlWorker });

serve(
  {
    fetch: app.fetch,
    port: config.port,
  },
  (info) => {
    console.log(
      `Veritag backend listening on http://localhost:${info.port} (${config.stellarNetwork})`,
    );
  },
);
