import { Address, xdr } from "@stellar/stellar-sdk";
import { hexToBytes32 } from "@veritag/sdk";
import type { BackendConfig } from "../config.js";
import type { Repository } from "../db/repository.js";
import type { SorobanTransactionService } from "./soroban-tx.js";

export interface TtlSweepReport {
  batchesChecked: number;
  unitsChecked: number;
  batchesBumped: number;
  unitsBumped: number;
  lastSweepAt: string;
}

/**
 * Background and on-demand worker that extends Soroban persistent storage TTLs
 * for active batches (`bump_batch_ttl`) and active units (`bump_unit_ttl`).
 */
export class TtlMaintenanceWorker {
  private readonly config: BackendConfig;
  private readonly repo: Repository;
  private readonly sorobanTx: SorobanTransactionService;
  private timer: NodeJS.Timeout | null = null;
  private lastReport: TtlSweepReport | null = null;

  constructor(params: {
    config: BackendConfig;
    repo: Repository;
    sorobanTx: SorobanTransactionService;
  }) {
    this.config = params.config;
    this.repo = params.repo;
    this.sorobanTx = params.sorobanTx;
  }

  getLastReport(): TtlSweepReport | null {
    return this.lastReport;
  }

  async runSweep(): Promise<TtlSweepReport> {
    const [batches, units] = await Promise.all([
      this.repo.listAllBatches(),
      this.repo.listAllUnits(),
    ]);

    let batchesBumped = 0;
    let unitsBumped = 0;

    for (const batch of batches) {
      if (batch.recalled) continue;
      try {
        await this.sorobanTx.relayContractCall({
          contractId: this.config.registryContractId,
          method: "bump_batch_ttl",
          args: [
            Address.fromString(batch.brand).toScVal(),
            xdr.ScVal.scvBytes(hexToBytes32(batch.batchId)),
          ],
        });
        batchesBumped++;
      } catch {
        // Continue sweeping remaining batches
      }
    }

    const nowSec = Math.floor(Date.now() / 1000);
    for (const unit of units) {
      if (unit.status !== "Active" || unit.warrantyExpiry < nowSec) continue;
      try {
        await this.sorobanTx.relayContractCall({
          contractId: this.config.registryContractId,
          method: "bump_unit_ttl",
          args: [xdr.ScVal.scvBytes(hexToBytes32(unit.unitId))],
        });
        unitsBumped++;
      } catch {
        // Continue sweeping remaining units
      }
    }

    const report: TtlSweepReport = {
      batchesChecked: batches.length,
      unitsChecked: units.length,
      batchesBumped,
      unitsBumped,
      lastSweepAt: new Date().toISOString(),
    };
    this.lastReport = report;
    return report;
  }

  start(intervalMs = 3_600_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runSweep();
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
