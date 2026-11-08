import { computeSerialHash, hexToBytes32, RegistryContract } from "@veritag/sdk";

export type VerificationStatus =
  | "AuthenticInactive"
  | "AuthenticActive"
  | "AlreadyClaimedWarning"
  | "Flagged"
  | "Recalled"
  | "Retired"
  | "Unknown";

export interface VerificationSummary {
  status: VerificationStatus;
  authentic: boolean;
  unitId: string;
  brand: {
    address: string;
    domain: string | null;
    verified: boolean;
  };
  batch: {
    batchId: string;
    merkleRoot: string;
    warrantyMonths: number;
    recalled: boolean;
  } | null;
  unit: {
    ownerAnonymized: string;
    status: string;
    activatedAt: number;
    warrantyExpiry: number;
    warrantyValid: boolean;
    claimsUsed: number;
    duplicateAttempts: number;
    ownershipTransfers: number;
  } | null;
  scanCount: number;
  suspiciousScanVolume: boolean;
  contractId: string;
  ledgerSequence: number | null;
  chainRpcSimulated?: boolean;
  source: "soroban-rpc+api" | "soroban-rpc-direct" | "demo-preview";
}

export interface UnitTimelineEvent {
  id: string;
  type: string;
  ledger: number;
  txHash: string;
  finalized: boolean;
  createdAt: string;
  data: Record<string, unknown>;
}

export interface UnitClaimSummary {
  unitId: string;
  claimId: number;
  serviceCenter: string;
  outcome: string;
  reportHash: string;
  filedAt: number;
  resolvedAt: number | null;
}

export const PUBLIC_CONFIG = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",
  contractId:
    process.env.NEXT_PUBLIC_REGISTRY_CONTRACT_ID ??
    "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  accountFactoryContractId:
    process.env.NEXT_PUBLIC_ACCOUNT_FACTORY_CONTRACT_ID ??
    "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  rpcUrl: process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org",
  networkPassphrase:
    process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015",
};

export function createRegistryReadClient(): RegistryContract.Client {
  return new RegistryContract.Client({
    contractId: PUBLIC_CONFIG.contractId,
    networkPassphrase: PUBLIC_CONFIG.networkPassphrase,
    rpcUrl: PUBLIC_CONFIG.rpcUrl,
    allowHttp: PUBLIC_CONFIG.rpcUrl.startsWith("http://"),
  });
}

export async function fetchLatestLedgerSequence(timeoutMs = 1500): Promise<number | null> {
  try {
    const res = await fetch(PUBLIC_CONFIG.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getLatestLedger",
      }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: { sequence?: number } };
    return typeof json.result?.sequence === "number" ? json.result.sequence : null;
  } catch {
    return null;
  }
}

export async function simulateDirectOnChainVerify(
  brand: string,
  batch: string,
  _serial: string,
): Promise<boolean> {
  if (PUBLIC_CONFIG.contractId === "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4") {
    return false;
  }
  try {
    const client = createRegistryReadClient();
    const tx = await client.get_batch({
      brand,
      batch_id: hexToBytes32(batch),
    });
    return Boolean(tx.result);
  } catch {
    return false;
  }
}

function buildDemoSummary(brand: string, batch: string, serial: string): VerificationSummary {
  const upper = serial.toUpperCase();
  const baseBrand = {
    address: brand,
    domain: "chronos-watches.swiss",
    verified: true,
  };
  const baseBatch = {
    batchId: batch,
    merkleRoot: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    warrantyMonths: 24,
    recalled: upper.includes("RECALL"),
  };

  if (upper.includes("FAKE") || upper.includes("UNKNOWN")) {
    return {
      status: "Unknown",
      authentic: false,
      unitId: "0".repeat(64),
      brand: { address: brand, domain: null, verified: false },
      batch: null,
      unit: null,
      scanCount: 1,
      suspiciousScanVolume: false,
      contractId: PUBLIC_CONFIG.contractId,
      ledgerSequence: null,
      source: "demo-preview",
    };
  }

  if (upper.includes("RECALL")) {
    return {
      status: "Recalled",
      authentic: true,
      unitId: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      brand: baseBrand,
      batch: { ...baseBatch, recalled: true },
      unit: null,
      scanCount: 14,
      suspiciousScanVolume: false,
      contractId: PUBLIC_CONFIG.contractId,
      ledgerSequence: null,
      source: "demo-preview",
    };
  }

  if (upper.includes("DUP") || upper.includes("CLONE")) {
    const now = Math.floor(Date.now() / 1000);
    return {
      status: "AlreadyClaimedWarning",
      authentic: true,
      unitId: "a1b2c3d4e5f60718293a4b5c6d7e8f9011223344556677889900aabbccddeeff",
      brand: baseBrand,
      batch: baseBatch,
      unit: {
        ownerAnonymized: "GD7Q2...9X4K",
        status: "Active",
        activatedAt: now - 86_400 * 40,
        warrantyExpiry: now + 86_400 * 680,
        warrantyValid: true,
        claimsUsed: 0,
        duplicateAttempts: 3,
        ownershipTransfers: 0,
      },
      scanCount: 412,
      suspiciousScanVolume: true,
      contractId: PUBLIC_CONFIG.contractId,
      ledgerSequence: null,
      source: "demo-preview",
    };
  }

  if (upper.includes("ACTIVE") || upper.includes("OWNED")) {
    const now = Math.floor(Date.now() / 1000);
    return {
      status: "AuthenticActive",
      authentic: true,
      unitId: "55aa66bb77cc88dd99ee00ff112233445566778899aabbccddeeff0011223344",
      brand: baseBrand,
      batch: baseBatch,
      unit: {
        ownerAnonymized: "GB9M4...2P8W",
        status: "Active",
        activatedAt: now - 86_400 * 90,
        warrantyExpiry: now + 86_400 * 630,
        warrantyValid: true,
        claimsUsed: 1,
        duplicateAttempts: 0,
        ownershipTransfers: 1,
      },
      scanCount: 4,
      suspiciousScanVolume: false,
      contractId: PUBLIC_CONFIG.contractId,
      ledgerSequence: null,
      source: "demo-preview",
    };
  }

  return {
    status: "AuthenticInactive",
    authentic: true,
    unitId: "7c4a8d09ca3762af61e59520943dc26494f8941b00112233445566778899aabb",
    brand: baseBrand,
    batch: baseBatch,
    unit: null,
    scanCount: 1,
    suspiciousScanVolume: false,
    contractId: PUBLIC_CONFIG.contractId,
    ledgerSequence: null,
    source: "demo-preview",
  };
}

export async function verifyProduct(
  brand: string,
  batch: string,
  serial: string,
): Promise<VerificationSummary> {
  const ledgerPromise = fetchLatestLedgerSequence();
  const rpcSimPromise = simulateDirectOnChainVerify(brand, batch, serial);

  try {
    const res = await fetch(
      `${PUBLIC_CONFIG.apiUrl}/v1/verify/${encodeURIComponent(brand)}/${encodeURIComponent(batch)}/${encodeURIComponent(serial)}`,
      { cache: "no-store", signal: AbortSignal.timeout(2000) },
    );
    if (res.ok) {
      const data = (await res.json()) as Omit<VerificationSummary, "ledgerSequence" | "source">;
      const [ledgerSequence, chainRpcSimulated] = await Promise.all([
        ledgerPromise,
        rpcSimPromise,
      ]);
      return {
        ...data,
        ledgerSequence,
        chainRpcSimulated,
        source: "soroban-rpc+api",
      };
    }
  } catch {
    // Offline or demo preview mode when backend is not running locally
  }

  const demo = buildDemoSummary(brand, batch, serial);
  demo.ledgerSequence = await ledgerPromise;
  demo.chainRpcSimulated = await rpcSimPromise;
  return demo;
}

export async function fetchUnitTimeline(unitId: string): Promise<{
  claims: UnitClaimSummary[];
  timeline: UnitTimelineEvent[];
}> {
  try {
    const res = await fetch(`${PUBLIC_CONFIG.apiUrl}/v1/units/${encodeURIComponent(unitId)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        claims: UnitClaimSummary[];
        timeline: UnitTimelineEvent[];
      };
      return {
        claims: data.claims ?? [],
        timeline: data.timeline ?? [],
      };
    }
  } catch {
    // Offline fallback
  }
  return { claims: [], timeline: [] };
}

export function getFileDownloadUrl(hash: string): string {
  return `${PUBLIC_CONFIG.apiUrl}/v1/files/${encodeURIComponent(hash)}`;
}
