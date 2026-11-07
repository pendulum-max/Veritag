import { scValToNative, xdr } from "@stellar/stellar-sdk";

export interface RawSorobanEvent {
  id: string;
  ledger: number;
  txHash: string;
  ledgerClosedAt?: string;
  topic: ReadonlyArray<xdr.ScVal | string>;
  value: xdr.ScVal | string;
}

export type DecodedRegistryEvent =
  | {
      type: "brand_registered";
      id: string;
      ledger: number;
      txHash: string;
      createdAt: string;
      brand: string;
      domain: string;
    }
  | {
      type: "brand_verified";
      id: string;
      ledger: number;
      txHash: string;
      createdAt: string;
      brand: string;
    }
  | {
      type: "service_center_registered";
      id: string;
      ledger: number;
      txHash: string;
      createdAt: string;
      brand: string;
      serviceCenter: string;
      authorized: boolean;
    }
  | {
      type: "batch_committed";
      id: string;
      ledger: number;
      txHash: string;
      createdAt: string;
      brand: string;
      batchId: string;
      root: string;
      warrantyMonths: number;
      unitCount: number;
    }
  | {
      type: "unit_activated";
      id: string;
      ledger: number;
      txHash: string;
      createdAt: string;
      unitId: string;
      brand: string;
      batchId: string;
      owner: string;
      warrantyExpiry: number;
    }
  | {
      type: "duplicate_attempt";
      id: string;
      ledger: number;
      txHash: string;
      createdAt: string;
      unitId: string;
      caller: string;
    }
  | {
      type: "transfer_offered";
      id: string;
      ledger: number;
      txHash: string;
      createdAt: string;
      unitId: string;
      codeHash: string;
      expiresAt: number;
    }
  | {
      type: "transfer_cancelled";
      id: string;
      ledger: number;
      txHash: string;
      createdAt: string;
      unitId: string;
    }
  | {
      type: "unit_transferred";
      id: string;
      ledger: number;
      txHash: string;
      createdAt: string;
      unitId: string;
      from: string;
      to: string;
    }
  | {
      type: "claim_filed";
      id: string;
      ledger: number;
      txHash: string;
      createdAt: string;
      unitId: string;
      claimId: number;
      serviceCenter: string;
    }
  | {
      type: "claim_resolved";
      id: string;
      ledger: number;
      txHash: string;
      createdAt: string;
      unitId: string;
      claimId: number;
      outcome: "Pending" | "Approved" | "Rejected" | "Repaired" | "Replaced";
      reportHash: string;
    }
  | {
      type: "unit_flagged";
      id: string;
      ledger: number;
      txHash: string;
      createdAt: string;
      unitId: string;
      reasonHash: string;
    }
  | {
      type: "batch_recalled";
      id: string;
      ledger: number;
      txHash: string;
      createdAt: string;
      brand: string;
      batchId: string;
      reasonHash: string;
    };

function toScVal(item: xdr.ScVal | string): xdr.ScVal {
  return typeof item === "string" ? xdr.ScVal.fromXDR(item, "base64") : item;
}

function asHex(val: unknown): string {
  if (val instanceof Uint8Array || Buffer.isBuffer(val)) {
    return Buffer.from(val).toString("hex");
  }
  if (typeof val === "string") {
    return val;
  }
  throw new Error(`Expected byte buffer or hex string, got ${typeof val}`);
}

function asNumber(val: unknown): number {
  if (typeof val === "bigint") return Number(val);
  if (typeof val === "number") return val;
  if (typeof val === "string") return Number(val);
  throw new Error(`Expected numeric value, got ${typeof val}`);
}

const CLAIM_OUTCOMES: ReadonlyArray<"Pending" | "Approved" | "Rejected" | "Repaired" | "Replaced"> = [
  "Pending",
  "Approved",
  "Rejected",
  "Repaired",
  "Replaced",
];

function decodeOutcome(
  raw: unknown,
): "Pending" | "Approved" | "Rejected" | "Repaired" | "Replaced" {
  if (typeof raw === "number" || typeof raw === "bigint") {
    return CLAIM_OUTCOMES[Number(raw)] ?? "Pending";
  }
  if (Array.isArray(raw) && typeof raw[0] === "string") {
    const tag = raw[0] as "Pending" | "Approved" | "Rejected" | "Repaired" | "Replaced";
    if (CLAIM_OUTCOMES.includes(tag)) return tag;
  }
  if (typeof raw === "string" && (CLAIM_OUTCOMES as readonly string[]).includes(raw)) {
    return raw as "Pending" | "Approved" | "Rejected" | "Repaired" | "Replaced";
  }
  return "Pending";
}

export function decodeRegistryEvent(raw: RawSorobanEvent): DecodedRegistryEvent | null {
  if (raw.topic.length === 0) return null;

  const topicsNative = raw.topic.map((t) => scValToNative(toScVal(t)) as unknown);
  const eventName = String(topicsNative[0] ?? "");
  const dataVal = scValToNative(toScVal(raw.value)) as Record<string, unknown> | null;
  const data = dataVal && typeof dataVal === "object" ? dataVal : {};
  const createdAt = raw.ledgerClosedAt ?? new Date().toISOString();
  const base = { id: raw.id, ledger: raw.ledger, txHash: raw.txHash, createdAt };

  switch (eventName) {
    case "brand_registered":
      return {
        ...base,
        type: "brand_registered",
        brand: String(topicsNative[1]),
        domain: String(data.domain ?? ""),
      };

    case "brand_verified":
      return {
        ...base,
        type: "brand_verified",
        brand: String(topicsNative[1]),
      };

    case "service_center_registered":
      return {
        ...base,
        type: "service_center_registered",
        brand: String(topicsNative[1]),
        serviceCenter: String(topicsNative[2]),
        authorized: Boolean(data.authorized),
      };

    case "batch_committed":
      return {
        ...base,
        type: "batch_committed",
        brand: String(topicsNative[1]),
        batchId: asHex(topicsNative[2]),
        root: asHex(data.root),
        warrantyMonths: asNumber(data.warranty_months),
        unitCount: asNumber(data.unit_count),
      };

    case "unit_activated":
      return {
        ...base,
        type: "unit_activated",
        unitId: asHex(topicsNative[1]),
        brand: String(data.brand),
        batchId: asHex(data.batch_id),
        owner: String(data.owner),
        warrantyExpiry: asNumber(data.warranty_expiry),
      };

    case "duplicate_attempt":
      return {
        ...base,
        type: "duplicate_attempt",
        unitId: asHex(topicsNative[1]),
        caller: String(data.caller),
      };

    case "transfer_offered":
      return {
        ...base,
        type: "transfer_offered",
        unitId: asHex(topicsNative[1]),
        codeHash: asHex(data.code_hash),
        expiresAt: asNumber(data.expires_at),
      };

    case "transfer_cancelled":
      return {
        ...base,
        type: "transfer_cancelled",
        unitId: asHex(topicsNative[1]),
      };

    case "unit_transferred":
      return {
        ...base,
        type: "unit_transferred",
        unitId: asHex(topicsNative[1]),
        from: String(data.from),
        to: String(data.to),
      };

    case "claim_filed":
      return {
        ...base,
        type: "claim_filed",
        unitId: asHex(topicsNative[1]),
        claimId: asNumber(data.claim_id),
        serviceCenter: String(data.service_center),
      };

    case "claim_resolved":
      return {
        ...base,
        type: "claim_resolved",
        unitId: asHex(topicsNative[1]),
        claimId: asNumber(data.claim_id),
        outcome: decodeOutcome(data.outcome),
        reportHash: asHex(data.report_hash),
      };

    case "unit_flagged":
      return {
        ...base,
        type: "unit_flagged",
        unitId: asHex(topicsNative[1]),
        reasonHash: asHex(data.reason_hash),
      };

    case "batch_recalled":
      return {
        ...base,
        type: "batch_recalled",
        brand: String(topicsNative[1]),
        batchId: asHex(topicsNative[2]),
        reasonHash: asHex(data.reason_hash),
      };

    default:
      return null;
  }
}
