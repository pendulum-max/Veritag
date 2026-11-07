import {
  FeeBumpTransaction,
  Keypair,
  Transaction,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";

export interface SponsorQuotaOptions {
  maxStroopsPerUserWindow: number;
  maxStroopsPerIpWindow?: number;
  maxTxFeeStroops?: number;
  windowMs?: number;
}

export interface RelayerService {
  sponsorFeeBump(params: {
    innerTxXdr: string;
    callerAccount: string;
    callerIp: string;
  }): Promise<{ feeBumpTxXdr: string; hash: string; feeChargedStroops: number }>;
}

/**
 * Wraps user-signed Soroban contract invocations into sponsored FeeBumpTransactions
 * while enforcing strict per-user, per-IP, per-tx fee caps and contract-invocation checks.
 */
export class StellarFeeSponsorService implements RelayerService {
  private readonly sponsorKeypair: Keypair | null;
  private readonly networkPassphrase: string;
  private readonly maxStroopsPerUser: number;
  private readonly maxStroopsPerIp: number;
  private readonly maxTxFeeStroops: number;
  private readonly windowMs: number;
  private readonly userSpend = new Map<string, Array<{ ts: number; stroops: number }>>();
  private readonly ipSpend = new Map<string, Array<{ ts: number; stroops: number }>>();

  constructor(params: {
    sponsorSecret: string;
    networkPassphrase: string;
    quota: SponsorQuotaOptions;
  }) {
    this.sponsorKeypair =
      params.sponsorSecret &&
      params.sponsorSecret !== "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4"
        ? Keypair.fromSecret(params.sponsorSecret)
        : null;
    this.networkPassphrase = params.networkPassphrase;
    this.maxStroopsPerUser = params.quota.maxStroopsPerUserWindow;
    this.maxStroopsPerIp = params.quota.maxStroopsPerIpWindow ?? params.quota.maxStroopsPerUserWindow * 2;
    this.maxTxFeeStroops = params.quota.maxTxFeeStroops ?? 2_000_000;
    this.windowMs = params.quota.windowMs ?? 3_600_000;
  }

  private checkAndRecordSpend(
    bucket: Map<string, Array<{ ts: number; stroops: number }>>,
    key: string,
    feeStroops: number,
    cap: number,
  ): void {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const recent = (bucket.get(key) ?? []).filter((entry) => entry.ts > cutoff);
    const spent = recent.reduce((acc, entry) => acc + entry.stroops, 0);
    if (spent + feeStroops > cap) {
      throw new Error("SponsorQuotaExceeded");
    }
    recent.push({ ts: now, stroops: feeStroops });
    bucket.set(key, recent);
  }

  async sponsorFeeBump(params: {
    innerTxXdr: string;
    callerAccount: string;
    callerIp: string;
  }): Promise<{ feeBumpTxXdr: string; hash: string; feeChargedStroops: number }> {
    if (!this.sponsorKeypair) {
      throw new Error("SponsorNotConfigured");
    }

    const parsed = TransactionBuilder.fromXDR(params.innerTxXdr, this.networkPassphrase);
    if (parsed instanceof FeeBumpTransaction) {
      throw new Error("NestedFeeBumpNotAllowed");
    }
    const innerTx = parsed as Transaction;

    // Only sponsor Soroban contract invocations or ledger entry restorations (never XLM payments/drains).
    const op = innerTx.operations[0];
    if (!op || innerTx.operations.length !== 1) {
      throw new Error("UnsupportedOperationCount");
    }
    if (
      op.type !== "invokeHostFunction" &&
      op.type !== "restoreFootprint" &&
      op.type !== "extendFootprintTtl"
    ) {
      throw new Error("UnsupportedSponsoredOperation");
    }

    const innerFee = Number(innerTx.fee);
    const sponsoredFee = Math.max(innerFee + 1000, 10_000);
    if (sponsoredFee > this.maxTxFeeStroops) {
      throw new Error("FeeExceedsMaxAllowed");
    }

    this.checkAndRecordSpend(this.userSpend, params.callerAccount, sponsoredFee, this.maxStroopsPerUser);
    this.checkAndRecordSpend(this.ipSpend, params.callerIp, sponsoredFee, this.maxStroopsPerIp);

    const feeBump = TransactionBuilder.buildFeeBumpTransaction(
      this.sponsorKeypair,
      String(sponsoredFee),
      innerTx,
      this.networkPassphrase,
    );
    feeBump.sign(this.sponsorKeypair);

    // Validate XDR round-trip
    const envelopeXdr = feeBump.toEnvelope().toXDR("base64");
    xdr.TransactionEnvelope.fromXDR(envelopeXdr, "base64");

    return {
      feeBumpTxXdr: envelopeXdr,
      hash: Buffer.from(feeBump.hash()).toString("hex"),
      feeChargedStroops: sponsoredFee,
    };
  }
}
