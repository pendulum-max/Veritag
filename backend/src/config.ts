export interface BackendConfig {
  stellarNetwork: string;
  sorobanRpcUrl: string;
  horizonUrl: string;
  networkPassphrase: string;
  registryContractId: string;
  accountFactoryContractId: string;
  passkeyAccountWasmHash: string;
  registryAdminSecret: string;
  sponsorSecret: string;
  databaseUrl: string;
  port: number;
  jwtSecret: string;
  rateLimitPerMin: number;
  maxSponsorStroopsPerUserWindow: number;
  appBaseUrl: string;
  s3Endpoint: string;
  s3Bucket: string;
  localStorageDir: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BackendConfig {
  return {
    stellarNetwork: env.STELLAR_NETWORK ?? "testnet",
    sorobanRpcUrl: env.SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org",
    horizonUrl: env.HORIZON_URL ?? "https://horizon-testnet.stellar.org",
    networkPassphrase: env.NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015",
    registryContractId:
      env.REGISTRY_CONTRACT_ID ?? "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    accountFactoryContractId:
      env.ACCOUNT_FACTORY_CONTRACT_ID ??
      "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    passkeyAccountWasmHash:
      env.PASSKEY_ACCOUNT_WASM_HASH ??
      "d1fac387cf017ab59c6aa425090685d55d624d759aa1a6d808cce03b38cf263f",
    registryAdminSecret: env.REGISTRY_ADMIN_SECRET ?? "",
    sponsorSecret: env.SPONSOR_SECRET ?? "",
    databaseUrl: env.DATABASE_URL ?? "postgres://veritag:veritag@localhost:5432/veritag",
    port: Number(env.BACKEND_PORT ?? 4000),
    jwtSecret: env.JWT_SECRET ?? "change-me-in-production",
    rateLimitPerMin: Number(env.RATE_LIMIT_PER_MIN ?? 30),
    maxSponsorStroopsPerUserWindow: Number(env.MAX_SPONSOR_STROOPS_PER_HOUR ?? 10_000_000),
    appBaseUrl: env.APP_BASE_URL ?? "http://localhost:3000",
    s3Endpoint: env.S3_ENDPOINT ?? "http://localhost:9000",
    s3Bucket: env.S3_BUCKET ?? "veritag-files",
    localStorageDir: env.LOCAL_STORAGE_DIR ?? ".data/storage",
  };
}
