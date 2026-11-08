import { Hono } from "hono";
import { cors } from "hono/cors";
import { type BackendConfig, loadConfig } from "./config.js";
import { InMemoryRepository, type Repository } from "./db/repository.js";
import { createV1Router } from "./routes/api.js";
import { AuthService, SlidingWindowRateLimiter } from "./services/auth.js";
import { type RelayerService, StellarFeeSponsorService } from "./services/relayer.js";
import { SorobanTransactionService } from "./services/soroban-tx.js";
import { ContentAddressedMemoryStorage, type ObjectStorageAdapter } from "./services/storage.js";
import { TtlMaintenanceWorker } from "./services/ttl-worker.js";

export interface CreateAppOptions {
  config?: BackendConfig;
  repo?: Repository;
  auth?: AuthService;
  rateLimiter?: SlidingWindowRateLimiter;
  storage?: ObjectStorageAdapter;
  relayer?: RelayerService;
  sorobanTx?: SorobanTransactionService;
  ttlWorker?: TtlMaintenanceWorker;
  tomlFetch?: typeof fetch;
}

export function createApp(options: CreateAppOptions = {}): Hono {
  const config = options.config ?? loadConfig();
  const repo = options.repo ?? new InMemoryRepository();
  const auth = options.auth ?? new AuthService(config.jwtSecret);
  const rateLimiter =
    options.rateLimiter ?? new SlidingWindowRateLimiter(config.rateLimitPerMin, 60_000);
  const storage = options.storage ?? new ContentAddressedMemoryStorage(config.s3Bucket);
  const relayer =
    options.relayer ??
    new StellarFeeSponsorService({
      sponsorSecret: config.sponsorSecret,
      networkPassphrase: config.networkPassphrase,
      quota: {
        maxStroopsPerUserWindow: config.maxSponsorStroopsPerUserWindow,
      },
    });
  const sorobanTx = options.sorobanTx ?? new SorobanTransactionService(config);
  const ttlWorker =
    options.ttlWorker ?? new TtlMaintenanceWorker({ config, repo, sorobanTx });

  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
    }),
  );

  app.get("/health", (c) =>
    c.json({
      status: "ok",
      service: "veritag-backend",
      network: config.stellarNetwork,
      contractId: config.registryContractId,
      accountFactoryContractId: config.accountFactoryContractId,
    }),
  );

  app.route(
    "/v1",
    createV1Router({
      config,
      repo,
      auth,
      rateLimiter,
      storage,
      relayer,
      sorobanTx,
      ttlWorker,
      tomlFetch: options.tomlFetch,
    }),
  );

  return app;
}
