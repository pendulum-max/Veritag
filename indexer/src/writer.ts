import pg from "pg";
import type { DecodedEvent } from "./decoder.js";
import { AlertService, type AlertContext } from "./alerts.js";

export interface IndexerCursorState {
  lastLedger: number;
  lastCursor: string;
}

export interface IndexerWriter {
  getCursor(streamId?: string): Promise<IndexerCursorState>;
  saveCursor(state: IndexerCursorState, streamId?: string): Promise<void>;
  applyEvent(event: DecodedEvent, finalized: boolean): Promise<{ applied: boolean }>;
  finalizeEventsUpTo(confirmedLedger: number, minLedger?: number): Promise<number>;
}

const DEFAULT_STREAM_ID = "soroban-registry";
const DEFAULT_PARTITION_SIZE = 100_000;

export interface ProvenanceEdge {
  id: string;
  unitId: string;
  fromNode: string;
  toNode: string;
  transitionType: "UnitActivated" | "UnitTransferred" | "UnitRetired";
  txHash: string;
  blockTime: string;
}

export class InMemoryIndexerWriter implements IndexerWriter {
  private readonly alerts?: AlertService;
  private readonly cursors = new Map<string, IndexerCursorState>();

  constructor(alerts?: AlertService) {
    this.alerts = alerts;
  }
  public readonly events = new Map<
    string,
    { event: DecodedEvent; finalized: boolean }
  >();
  public readonly deployedAccounts = new Set<string>();
  public readonly brands = new Map<string, { domain: string; verified: boolean }>();
  public readonly batches = new Map<
    string,
    { merkleRoot: string; warrantyMonths: number; unitCount: number; recalled: boolean }
  >();
  public readonly units = new Map<
    string,
    {
      brand: string;
      batchId: string;
      owner: string;
      status: string;
      warrantyExpiry: number;
      claimsUsed: number;
      duplicateAttempts: number;
    }
  >();
  public readonly claims = new Map<
    string,
    { serviceCenter: string; outcome: string; reportHash: string }
  >();
  public readonly provenanceEdges: ProvenanceEdge[] = [];

  async getCursor(streamId = DEFAULT_STREAM_ID): Promise<IndexerCursorState> {
    return this.cursors.get(streamId) ?? { lastLedger: 0, lastCursor: "" };
  }

  async saveCursor(state: IndexerCursorState, streamId = DEFAULT_STREAM_ID): Promise<void> {
    this.cursors.set(streamId, { ...state });
  }

  async applyEvent(event: DecodedEvent, finalized: boolean): Promise<{ applied: boolean }> {
    const existing = this.events.get(event.id);
    if (existing) {
      if (finalized && !existing.finalized) {
        this.events.set(event.id, { ...existing, finalized: true });
      }
      return { applied: false };
    }

    this.events.set(event.id, { event, finalized });

    switch (event.type) {
      case "brand_registered":
        this.brands.set(event.brand, { domain: event.domain, verified: false });
        break;
      case "brand_verified": {
        const prev = this.brands.get(event.brand);
        this.brands.set(event.brand, { domain: prev?.domain ?? "", verified: true });
        break;
      }
      case "batch_committed":
        this.batches.set(`${event.brand}:${event.batchId}`, {
          merkleRoot: event.root,
          warrantyMonths: event.warrantyMonths,
          unitCount: event.unitCount,
          recalled: false,
        });
        break;
      case "unit_activated":
        this.units.set(event.unitId, {
          brand: event.brand,
          batchId: event.batchId,
          owner: event.owner,
          status: "Active",
          warrantyExpiry: event.warrantyExpiry,
          claimsUsed: 0,
          duplicateAttempts: 0,
        });
        this.provenanceEdges.push({
          id: `${event.id}:UnitActivated`,
          unitId: event.unitId,
          fromNode: event.brand,
          toNode: event.owner,
          transitionType: "UnitActivated",
          txHash: event.txHash,
          blockTime: event.createdAt,
        });
        break;
      case "duplicate_attempt": {
        const u = this.units.get(event.unitId);
        if (u) {
          this.units.set(event.unitId, { ...u, duplicateAttempts: u.duplicateAttempts + 1 });
        }
        break;
      }
      case "unit_transferred": {
        const u = this.units.get(event.unitId);
        if (u) {
          this.units.set(event.unitId, { ...u, owner: event.to });
        }
        this.provenanceEdges.push({
          id: `${event.id}:UnitTransferred`,
          unitId: event.unitId,
          fromNode: event.from,
          toNode: event.to,
          transitionType: "UnitTransferred",
          txHash: event.txHash,
          blockTime: event.createdAt,
        });
        break;
      }
      case "claim_filed": {
        const u = this.units.get(event.unitId);
        if (u) {
          this.units.set(event.unitId, {
            ...u,
            claimsUsed: Math.max(u.claimsUsed, event.claimId),
          });
        }
        this.claims.set(`${event.unitId}:${event.claimId}`, {
          serviceCenter: event.serviceCenter,
          outcome: "Pending",
          reportHash: "",
        });
        break;
      }
      case "claim_resolved": {
        const key = `${event.unitId}:${event.claimId}`;
        const prev = this.claims.get(key);
        this.claims.set(key, {
          serviceCenter: prev?.serviceCenter ?? "",
          outcome: event.outcome,
          reportHash: event.reportHash,
        });
        if (event.outcome === "Replaced") {
          const u = this.units.get(event.unitId);
          if (u) {
            this.units.set(event.unitId, { ...u, status: "Retired" });
          }
          this.provenanceEdges.push({
            id: `${event.id}:UnitRetired`,
            unitId: event.unitId,
            fromNode: u?.owner ?? "",
            toNode: "RETIRED",
            transitionType: "UnitRetired",
            txHash: event.txHash,
            blockTime: event.createdAt,
          });
        }
        break;
      }
      case "unit_flagged": {
        const u = this.units.get(event.unitId);
        if (u) {
          this.units.set(event.unitId, { ...u, status: "Flagged" });
        }
        break;
      }
      case "batch_recalled": {
        const key = `${event.brand}:${event.batchId}`;
        const prev = this.batches.get(key);
        if (prev) {
          this.batches.set(key, { ...prev, recalled: true });
        }
        for (const [uid, u] of this.units.entries()) {
          if (u.brand === event.brand && u.batchId === event.batchId && u.status === "Active") {
            this.units.set(uid, { ...u, status: "Recalled" });
          }
        }
        break;
      }
      case "service_center_registered":
      case "transfer_offered":
      case "transfer_cancelled":
      case "passkey_added":
      case "passkey_removed":
      case "passkey_rotated":
      case "recovery_updated":
        break;
      case "account_deployed":
        this.deployedAccounts.add(event.account);
        break;
    }

    if (this.alerts && (event.type === "batch_recalled" || event.type === "unit_flagged")) {
      const ctx: AlertContext = {};
      if (event.type === "batch_recalled") {
        const brandInfo = this.brands.get(event.brand);
        ctx.brandDomain = brandInfo?.domain;
      } else if (event.type === "unit_flagged") {
        const unit = this.units.get(event.unitId);
        if (unit) {
          const brandInfo = this.brands.get(unit.brand);
          ctx.brandDomain = brandInfo?.domain;
        }
      }
      await this.alerts.dispatchAlert(event, ctx);
    }

    return { applied: true };
  }

  async finalizeEventsUpTo(confirmedLedger: number, minLedger = 0): Promise<number> {
    let count = 0;
    for (const [id, entry] of this.events.entries()) {
      if (
        !entry.finalized &&
        entry.event.ledger >= minLedger &&
        entry.event.ledger <= confirmedLedger
      ) {
        this.events.set(id, { ...entry, finalized: true });
        count++;
      }
    }
    return count;
  }
}

export class PostgresIndexerWriter implements IndexerWriter {
  private readonly pool: pg.Pool;
  private readonly alerts?: AlertService;

  constructor(databaseUrlOrPool: string | pg.Pool, alerts?: AlertService) {
    this.pool =
      typeof databaseUrlOrPool === "string"
        ? new pg.Pool({ connectionString: databaseUrlOrPool })
        : databaseUrlOrPool;
    this.alerts = alerts;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async getCursor(streamId = DEFAULT_STREAM_ID): Promise<IndexerCursorState> {
    const res = await this.pool.query(
      `SELECT last_ledger, last_cursor FROM indexer_state WHERE id = $1`,
      [streamId],
    );
    const row = res.rows[0];
    if (!row) {
      return { lastLedger: 0, lastCursor: "" };
    }
    return {
      lastLedger: Number(row.last_ledger),
      lastCursor: String(row.last_cursor),
    };
  }

  async saveCursor(state: IndexerCursorState, streamId = DEFAULT_STREAM_ID): Promise<void> {
    await this.pool.query(
      `INSERT INTO indexer_state (id, last_ledger, last_cursor, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (id) DO UPDATE
       SET last_ledger = EXCLUDED.last_ledger,
           last_cursor = EXCLUDED.last_cursor,
           updated_at = NOW()`,
      [streamId, state.lastLedger, state.lastCursor],
    );
  }

  async applyEvent(event: DecodedEvent, finalized: boolean): Promise<{ applied: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const unitId = "unitId" in event ? event.unitId : null;
      const brand = "brand" in event ? event.brand : null;
      const batchId = "batchId" in event ? event.batchId : null;
      const contractId = "contractId" in event ? (event.contractId ?? null) : null;

      await client.query(
        `INSERT INTO raw_events (id, contract_id, type, data, ledger, tx_hash, finalized, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
         ON CONFLICT (id, ledger) DO NOTHING`,
        [
          event.id,
          contractId,
          event.type,
          JSON.stringify(event),
          event.ledger,
          event.txHash,
          finalized,
          event.createdAt,
        ],
      );

      const insertRes = await client.query(
        `INSERT INTO unit_events (id, unit_id, brand, batch_id, type, data, ledger, tx_hash, finalized, created_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [
          event.id,
          unitId,
          brand,
          batchId,
          event.type,
          JSON.stringify(event),
          event.ledger,
          event.txHash,
          finalized,
          event.createdAt,
        ],
      );

      if (insertRes.rowCount === 0) {
        if (finalized) {
          await client.query(`UPDATE unit_events SET finalized = TRUE WHERE id = $1`, [event.id]);
          await client.query(
            `UPDATE raw_events SET finalized = TRUE WHERE id = $1 AND ledger = $2`,
            [event.id, event.ledger],
          );
        }
        await client.query("COMMIT");
        return { applied: false };
      }

      switch (event.type) {
        case "brand_registered":
          await client.query(
            `INSERT INTO brands (address, admin, domain, verified, created_at)
             VALUES ($1, $1, $2, FALSE, $3)
             ON CONFLICT (address) DO UPDATE SET domain = EXCLUDED.domain`,
            [event.brand, event.domain, event.createdAt],
          );
          break;

        case "brand_verified":
          await client.query(`UPDATE brands SET verified = TRUE WHERE address = $1`, [event.brand]);
          break;

        case "service_center_registered":
          await client.query(
            `INSERT INTO service_centers (brand, service_center, authorized, updated_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (brand, service_center) DO UPDATE
             SET authorized = EXCLUDED.authorized, updated_at = NOW()`,
            [event.brand, event.serviceCenter, event.authorized],
          );
          break;

        case "batch_committed":
          await client.query(
            `INSERT INTO batches (brand, batch_id, merkle_root, warranty_months, product_meta_hash, unit_count, recalled, created_at)
             VALUES ($1, $2, $3, $4, '', $5, FALSE, $6)
             ON CONFLICT (brand, batch_id) DO UPDATE
             SET merkle_root = EXCLUDED.merkle_root,
                 warranty_months = EXCLUDED.warranty_months,
                 unit_count = EXCLUDED.unit_count`,
            [
              event.brand,
              event.batchId,
              event.root,
              event.warrantyMonths,
              event.unitCount,
              event.createdAt,
            ],
          );
          break;

        case "unit_activated": {
          const tsSec = Math.floor(new Date(event.createdAt).getTime() / 1000);
          await client.query(
            `INSERT INTO units (unit_id, brand, batch_id, owner, status, activated_at, warranty_expiry, claims_used, duplicate_attempts, scan_count, updated_at)
             VALUES ($1, $2, $3, $4, 'Active', $5, $6, 0, 0, 0, NOW())
             ON CONFLICT (unit_id) DO UPDATE
             SET owner = EXCLUDED.owner, warranty_expiry = EXCLUDED.warranty_expiry, updated_at = NOW()`,
            [event.unitId, event.brand, event.batchId, event.owner, tsSec, event.warrantyExpiry],
          );
          await client.query(
            `INSERT INTO unit_provenance_edges (id, unit_id, from_node, to_node, transition_type, tx_hash, block_time)
             VALUES ($1, $2, $3, $4, 'UnitActivated', $5, $6)
             ON CONFLICT (id) DO NOTHING`,
            [
              `${event.id}:UnitActivated`,
              event.unitId,
              event.brand,
              event.owner,
              event.txHash,
              event.createdAt,
            ],
          );
          break;
        }

        case "duplicate_attempt":
          await client.query(
            `UPDATE units SET duplicate_attempts = duplicate_attempts + 1, updated_at = NOW() WHERE unit_id = $1`,
            [event.unitId],
          );
          break;

        case "unit_transferred":
          await client.query(
            `UPDATE units SET owner = $2, updated_at = NOW() WHERE unit_id = $1`,
            [event.unitId, event.to],
          );
          await client.query(
            `INSERT INTO unit_provenance_edges (id, unit_id, from_node, to_node, transition_type, tx_hash, block_time)
             VALUES ($1, $2, $3, $4, 'UnitTransferred', $5, $6)
             ON CONFLICT (id) DO NOTHING`,
            [
              `${event.id}:UnitTransferred`,
              event.unitId,
              event.from,
              event.to,
              event.txHash,
              event.createdAt,
            ],
          );
          break;

        case "claim_filed": {
          const filedAt = Math.floor(new Date(event.createdAt).getTime() / 1000);
          await client.query(
            `UPDATE units SET claims_used = GREATEST(claims_used, $2), updated_at = NOW() WHERE unit_id = $1`,
            [event.unitId, event.claimId],
          );
          await client.query(
            `INSERT INTO claims (unit_id, claim_id, service_center, outcome, report_hash, filed_at)
             VALUES ($1, $2, $3, 'Pending', '', $4)
             ON CONFLICT (unit_id, claim_id) DO NOTHING`,
            [event.unitId, event.claimId, event.serviceCenter, filedAt],
          );
          break;
        }

        case "claim_resolved": {
          const resolvedAt = Math.floor(new Date(event.createdAt).getTime() / 1000);
          await client.query(
            `UPDATE claims SET outcome = $3, report_hash = $4, resolved_at = $5
             WHERE unit_id = $1 AND claim_id = $2`,
            [event.unitId, event.claimId, event.outcome, event.reportHash, resolvedAt],
          );
          if (event.outcome === "Replaced") {
            await client.query(
              `INSERT INTO unit_provenance_edges (id, unit_id, from_node, to_node, transition_type, tx_hash, block_time)
               VALUES ($1, $2, COALESCE((SELECT owner FROM units WHERE unit_id = $2), ''), 'RETIRED', 'UnitRetired', $3, $4)
               ON CONFLICT (id) DO NOTHING`,
              [`${event.id}:UnitRetired`, event.unitId, event.txHash, event.createdAt],
            );
            await client.query(
              `UPDATE units SET status = 'Retired', updated_at = NOW() WHERE unit_id = $1`,
              [event.unitId],
            );
          }
          break;
        }

        case "unit_flagged":
          await client.query(
            `UPDATE units SET status = 'Flagged', updated_at = NOW() WHERE unit_id = $1`,
            [event.unitId],
          );
          break;

        case "batch_recalled":
          await client.query(
            `UPDATE batches SET recalled = TRUE, recall_reason_hash = $3 WHERE brand = $1 AND batch_id = $2`,
            [event.brand, event.batchId, event.reasonHash],
          );
          await client.query(
            `UPDATE units SET status = 'Recalled', updated_at = NOW()
             WHERE brand = $1 AND batch_id = $2 AND status = 'Active'`,
            [event.brand, event.batchId],
          );
          break;

        case "transfer_offered":
        case "transfer_cancelled":
        case "passkey_added":
        case "passkey_removed":
        case "passkey_rotated":
        case "recovery_updated":
          break;

        case "account_deployed":
          await client.query(
            `UPDATE passkey_wallets SET deployed = TRUE WHERE wallet_address = $1`,
            [event.account],
          );
          break;
      }

      await client.query("COMMIT");

      if (this.alerts && (event.type === "batch_recalled" || event.type === "unit_flagged")) {
        const ctx: AlertContext = {};
        if (event.type === "batch_recalled") {
          const dr = await this.pool.query(
            "SELECT domain FROM brands WHERE address = $1",
            [event.brand],
          );
          ctx.brandDomain = dr.rows[0]?.domain as string | undefined;
        } else if (event.type === "unit_flagged") {
          const dr = await this.pool.query(
            "SELECT b.domain FROM units u JOIN brands b ON u.brand = b.address WHERE u.unit_id = $1",
            [event.unitId],
          );
          ctx.brandDomain = dr.rows[0]?.domain as string | undefined;
        }
        await this.alerts.dispatchAlert(event, ctx);
      }

      return { applied: true };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Promotes unfinalized events up to `confirmedLedger` using explicit `ledger` bounds
   * so PostgreSQL partition pruning skips out-of-range `raw_events` partitions.
   */
  async finalizeEventsUpTo(confirmedLedger: number, minLedger = 0): Promise<number> {
    const res = await this.pool.query(
      `UPDATE unit_events SET finalized = TRUE WHERE finalized = FALSE AND ledger >= $1 AND ledger <= $2`,
      [minLedger, confirmedLedger],
    );
    await this.pool.query(
      `UPDATE raw_events SET finalized = TRUE WHERE finalized = FALSE AND ledger >= $1 AND ledger <= $2`,
      [minLedger, confirmedLedger],
    );
    return res.rowCount ?? 0;
  }

  /**
   * Queries `raw_events` with explicit `ledger` bounds to guarantee partition pruning.
   */
  async getRawEventsInLedgerRange(
    fromLedger: number,
    toLedger: number,
  ): Promise<Array<{ id: string; contract_id: string | null; type: string; ledger: number }>> {
    const res = await this.pool.query(
      `SELECT id, contract_id, type, ledger FROM raw_events
       WHERE ledger >= $1 AND ledger <= $2
       ORDER BY ledger ASC`,
      [fromLedger, toLedger],
    );
    return res.rows as Array<{
      id: string;
      contract_id: string | null;
      type: string;
      ledger: number;
    }>;
  }

  /**
   * Creates future 100,000-ledger partitions for `raw_events` and `unit_transfers`.
   */
  async ensurePartitionsForLedger(
    currentLedger: number,
    lookaheadPartitions = 1,
    partitionSize = DEFAULT_PARTITION_SIZE,
  ): Promise<void> {
    const baseBucket = Math.floor(currentLedger / partitionSize) * partitionSize;
    for (let i = 0; i <= lookaheadPartitions; i++) {
      const start = baseBucket + i * partitionSize;
      const end = start + partitionSize;
      for (const table of ["raw_events", "unit_transfers"] as const) {
        await this.pool.query(
          `CREATE TABLE IF NOT EXISTS ${table}_p${start} PARTITION OF ${table} FOR VALUES FROM (${start}) TO (${end})`,
        );
      }
    }
  }
}
