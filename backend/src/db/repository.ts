import pg from "pg";

export interface BrandRecord {
  address: string;
  admin: string;
  domain: string;
  verified: boolean;
  createdAt: string;
}

export interface BatchRecord {
  brand: string;
  batchId: string;
  merkleRoot: string;
  warrantyMonths: number;
  productMetaHash: string;
  unitCount: number;
  recalled: boolean;
  recallReasonHash: string | null;
  createdAt: string;
}

export interface BatchUnitProvisionRecord {
  unitId: string;
  brand: string;
  batchId: string;
  serial: string;
  serialHash: string;
  secretHash: string;
  encryptedSecret: string | null;
  proof: string[];
  exportedAt: string | null;
}

export interface UnitRecord {
  unitId: string;
  brand: string;
  batchId: string;
  owner: string;
  status: "Active" | "Flagged" | "Recalled" | "Retired";
  activatedAt: number;
  warrantyExpiry: number;
  claimsUsed: number;
  duplicateAttempts: number;
  scanCount: number;
}

export interface UnitEventRecord {
  id: string;
  unitId: string | null;
  brand: string | null;
  batchId: string | null;
  type: string;
  data: Record<string, unknown>;
  ledger: number;
  txHash: string;
  finalized: boolean;
  createdAt: string;
}

export interface ClaimRecord {
  unitId: string;
  claimId: number;
  serviceCenter: string;
  outcome: "Pending" | "Approved" | "Rejected" | "Repaired" | "Replaced";
  reportHash: string;
  filedAt: number;
  resolvedAt: number | null;
}

export interface FileMetadataRecord {
  hash: string;
  uploader: string;
  mime: string;
  size: number;
  storageKey: string;
  createdAt: string;
}

export interface TransferOfferCache {
  unitId: string;
  codeHash: string;
  expiresAt: number;
}

export interface Repository {
  upsertBrand(brand: BrandRecord): Promise<void>;
  getBrand(address: string): Promise<BrandRecord | null>;
  setServiceCenter(brand: string, serviceCenter: string, authorized: boolean): Promise<void>;
  isServiceCenter(brand: string, serviceCenter: string): Promise<boolean>;

  insertBatch(batch: BatchRecord, units: BatchUnitProvisionRecord[]): Promise<void>;
  getBatch(brand: string, batchId: string): Promise<BatchRecord | null>;
  listBrandBatches(brand: string): Promise<BatchRecord[]>;
  getBatchUnits(brand: string, batchId: string): Promise<BatchUnitProvisionRecord[]>;
  getBatchUnitBySerialHash(
    brand: string,
    batchId: string,
    serialHash: string,
  ): Promise<BatchUnitProvisionRecord | null>;
  purgeBatchSecrets(brand: string, batchId: string): Promise<void>;
  markBatchRecalled(brand: string, batchId: string, reasonHash: string): Promise<void>;

  upsertUnit(unit: UnitRecord): Promise<void>;
  getUnit(unitId: string): Promise<UnitRecord | null>;
  listOwnerUnits(owner: string): Promise<UnitRecord[]>;
  recordScan(unitId: string, ipHash: string, uaHash: string): Promise<number>;

  appendEvent(event: UnitEventRecord): Promise<void>;
  getUnitEvents(unitId: string): Promise<UnitEventRecord[]>;

  setTransferOffer(offer: TransferOfferCache): Promise<void>;
  getTransferOffer(unitId: string): Promise<TransferOfferCache | null>;
  deleteTransferOffer(unitId: string): Promise<void>;

  upsertClaim(claim: ClaimRecord): Promise<void>;
  getClaim(unitId: string, claimId: number): Promise<ClaimRecord | null>;
  listUnitClaims(unitId: string): Promise<ClaimRecord[]>;
  listServiceCenterClaims(serviceCenter: string): Promise<ClaimRecord[]>;

  saveFileMetadata(file: FileMetadataRecord): Promise<void>;
  getFileMetadata(hash: string): Promise<FileMetadataRecord | null>;
}

export class InMemoryRepository implements Repository {
  private readonly brands = new Map<string, BrandRecord>();
  private readonly serviceCenters = new Set<string>();
  private readonly batches = new Map<string, BatchRecord>();
  private readonly batchUnits = new Map<string, BatchUnitProvisionRecord>();
  private readonly units = new Map<string, UnitRecord>();
  private readonly events = new Map<string, UnitEventRecord>();
  private readonly offers = new Map<string, TransferOfferCache>();
  private readonly claims = new Map<string, ClaimRecord>();
  private readonly files = new Map<string, FileMetadataRecord>();
  private readonly scans = new Map<string, number>();

  async upsertBrand(brand: BrandRecord): Promise<void> {
    this.brands.set(brand.address, { ...brand });
  }

  async getBrand(address: string): Promise<BrandRecord | null> {
    return this.brands.get(address) ?? null;
  }

  async setServiceCenter(brand: string, serviceCenter: string, authorized: boolean): Promise<void> {
    const key = `${brand}:${serviceCenter}`;
    if (authorized) {
      this.serviceCenters.add(key);
    } else {
      this.serviceCenters.delete(key);
    }
  }

  async isServiceCenter(brand: string, serviceCenter: string): Promise<boolean> {
    return this.serviceCenters.has(`${brand}:${serviceCenter}`);
  }

  async insertBatch(batch: BatchRecord, units: BatchUnitProvisionRecord[]): Promise<void> {
    const key = `${batch.brand}:${batch.batchId}`;
    if (this.batches.has(key)) {
      throw new Error("BatchExists");
    }
    this.batches.set(key, { ...batch });
    for (const u of units) {
      this.batchUnits.set(u.unitId, { ...u, proof: [...u.proof] });
    }
  }

  async getBatch(brand: string, batchId: string): Promise<BatchRecord | null> {
    return this.batches.get(`${brand}:${batchId}`) ?? null;
  }

  async listBrandBatches(brand: string): Promise<BatchRecord[]> {
    return [...this.batches.values()].filter((b) => b.brand === brand);
  }

  async getBatchUnits(brand: string, batchId: string): Promise<BatchUnitProvisionRecord[]> {
    return [...this.batchUnits.values()].filter(
      (u) => u.brand === brand && u.batchId === batchId,
    );
  }

  async getBatchUnitBySerialHash(
    brand: string,
    batchId: string,
    serialHash: string,
  ): Promise<BatchUnitProvisionRecord | null> {
    for (const u of this.batchUnits.values()) {
      if (u.brand === brand && u.batchId === batchId && u.serialHash === serialHash) {
        return u;
      }
    }
    return null;
  }

  async purgeBatchSecrets(brand: string, batchId: string): Promise<void> {
    const now = new Date().toISOString();
    for (const [id, u] of this.batchUnits.entries()) {
      if (u.brand === brand && u.batchId === batchId) {
        this.batchUnits.set(id, { ...u, encryptedSecret: null, exportedAt: now });
      }
    }
  }

  async markBatchRecalled(brand: string, batchId: string, reasonHash: string): Promise<void> {
    const key = `${brand}:${batchId}`;
    const existing = this.batches.get(key);
    if (existing) {
      this.batches.set(key, { ...existing, recalled: true, recallReasonHash: reasonHash });
    }
    for (const [uid, unit] of this.units.entries()) {
      if (unit.brand === brand && unit.batchId === batchId && unit.status === "Active") {
        this.units.set(uid, { ...unit, status: "Recalled" });
      }
    }
  }

  async upsertUnit(unit: UnitRecord): Promise<void> {
    const currentScans = this.scans.get(unit.unitId) ?? unit.scanCount;
    this.units.set(unit.unitId, { ...unit, scanCount: currentScans });
  }

  async getUnit(unitId: string): Promise<UnitRecord | null> {
    const u = this.units.get(unitId);
    if (!u) return null;
    return { ...u, scanCount: this.scans.get(unitId) ?? u.scanCount };
  }

  async listOwnerUnits(owner: string): Promise<UnitRecord[]> {
    return [...this.units.values()].filter((u) => u.owner === owner);
  }

  async recordScan(unitId: string, _ipHash: string, _uaHash: string): Promise<number> {
    const next = (this.scans.get(unitId) ?? 0) + 1;
    this.scans.set(unitId, next);
    const existing = this.units.get(unitId);
    if (existing) {
      this.units.set(unitId, { ...existing, scanCount: next });
    }
    return next;
  }

  async appendEvent(event: UnitEventRecord): Promise<void> {
    this.events.set(event.id, { ...event });
  }

  async getUnitEvents(unitId: string): Promise<UnitEventRecord[]> {
    return [...this.events.values()]
      .filter((e) => e.unitId === unitId)
      .sort((a, b) => a.ledger - b.ledger);
  }

  async setTransferOffer(offer: TransferOfferCache): Promise<void> {
    this.offers.set(offer.unitId, { ...offer });
  }

  async getTransferOffer(unitId: string): Promise<TransferOfferCache | null> {
    return this.offers.get(unitId) ?? null;
  }

  async deleteTransferOffer(unitId: string): Promise<void> {
    this.offers.delete(unitId);
  }

  async upsertClaim(claim: ClaimRecord): Promise<void> {
    this.claims.set(`${claim.unitId}:${claim.claimId}`, { ...claim });
  }

  async getClaim(unitId: string, claimId: number): Promise<ClaimRecord | null> {
    return this.claims.get(`${unitId}:${claimId}`) ?? null;
  }

  async listUnitClaims(unitId: string): Promise<ClaimRecord[]> {
    return [...this.claims.values()]
      .filter((c) => c.unitId === unitId)
      .sort((a, b) => a.claimId - b.claimId);
  }

  async listServiceCenterClaims(serviceCenter: string): Promise<ClaimRecord[]> {
    return [...this.claims.values()].filter((c) => c.serviceCenter === serviceCenter);
  }

  async saveFileMetadata(file: FileMetadataRecord): Promise<void> {
    this.files.set(file.hash, { ...file });
  }

  async getFileMetadata(hash: string): Promise<FileMetadataRecord | null> {
    return this.files.get(hash) ?? null;
  }
}

export class PostgresRepository implements Repository {
  private readonly pool: pg.Pool;
  private readonly offers = new Map<string, TransferOfferCache>();

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async upsertBrand(brand: BrandRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO brands (address, admin, domain, verified, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (address) DO UPDATE
       SET admin = EXCLUDED.admin, domain = EXCLUDED.domain, verified = EXCLUDED.verified`,
      [brand.address, brand.admin, brand.domain, brand.verified, brand.createdAt],
    );
  }

  async getBrand(address: string): Promise<BrandRecord | null> {
    const res = await this.pool.query(
      `SELECT address, admin, domain, verified, created_at FROM brands WHERE address = $1`,
      [address],
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      address: String(row.address),
      admin: String(row.admin),
      domain: String(row.domain),
      verified: Boolean(row.verified),
      createdAt: new Date(String(row.created_at)).toISOString(),
    };
  }

  async setServiceCenter(brand: string, serviceCenter: string, authorized: boolean): Promise<void> {
    await this.pool.query(
      `INSERT INTO service_centers (brand, service_center, authorized, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (brand, service_center) DO UPDATE
       SET authorized = EXCLUDED.authorized, updated_at = NOW()`,
      [brand, serviceCenter, authorized],
    );
  }

  async isServiceCenter(brand: string, serviceCenter: string): Promise<boolean> {
    const res = await this.pool.query(
      `SELECT authorized FROM service_centers WHERE brand = $1 AND service_center = $2`,
      [brand, serviceCenter],
    );
    return Boolean(res.rows[0]?.authorized);
  }

  async insertBatch(batch: BatchRecord, units: BatchUnitProvisionRecord[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO batches (brand, batch_id, merkle_root, warranty_months, product_meta_hash, unit_count, recalled, recall_reason_hash, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          batch.brand,
          batch.batchId,
          batch.merkleRoot,
          batch.warrantyMonths,
          batch.productMetaHash,
          batch.unitCount,
          batch.recalled,
          batch.recallReasonHash,
          batch.createdAt,
        ],
      );
      for (const u of units) {
        await client.query(
          `INSERT INTO batch_units (unit_id, brand, batch_id, serial, serial_hash, secret_hash, encrypted_secret, proof)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
          [
            u.unitId,
            u.brand,
            u.batchId,
            u.serial,
            u.serialHash,
            u.secretHash,
            u.encryptedSecret,
            JSON.stringify(u.proof),
          ],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async getBatch(brand: string, batchId: string): Promise<BatchRecord | null> {
    const res = await this.pool.query(
      `SELECT * FROM batches WHERE brand = $1 AND batch_id = $2`,
      [brand, batchId],
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      brand: String(row.brand),
      batchId: String(row.batch_id),
      merkleRoot: String(row.merkle_root),
      warrantyMonths: Number(row.warranty_months),
      productMetaHash: String(row.product_meta_hash),
      unitCount: Number(row.unit_count),
      recalled: Boolean(row.recalled),
      recallReasonHash: row.recall_reason_hash ? String(row.recall_reason_hash) : null,
      createdAt: new Date(String(row.created_at)).toISOString(),
    };
  }

  async listBrandBatches(brand: string): Promise<BatchRecord[]> {
    const res = await this.pool.query(
      `SELECT * FROM batches WHERE brand = $1 ORDER BY created_at DESC`,
      [brand],
    );
    return res.rows.map((row) => ({
      brand: String(row.brand),
      batchId: String(row.batch_id),
      merkleRoot: String(row.merkle_root),
      warrantyMonths: Number(row.warranty_months),
      productMetaHash: String(row.product_meta_hash),
      unitCount: Number(row.unit_count),
      recalled: Boolean(row.recalled),
      recallReasonHash: row.recall_reason_hash ? String(row.recall_reason_hash) : null,
      createdAt: new Date(String(row.created_at)).toISOString(),
    }));
  }

  async getBatchUnits(brand: string, batchId: string): Promise<BatchUnitProvisionRecord[]> {
    const res = await this.pool.query(
      `SELECT * FROM batch_units WHERE brand = $1 AND batch_id = $2 ORDER BY created_at ASC`,
      [brand, batchId],
    );
    return res.rows.map((row) => ({
      unitId: String(row.unit_id),
      brand: String(row.brand),
      batchId: String(row.batch_id),
      serial: String(row.serial),
      serialHash: String(row.serial_hash),
      secretHash: String(row.secret_hash),
      encryptedSecret: row.encrypted_secret ? String(row.encrypted_secret) : null,
      proof: row.proof as string[],
      exportedAt: row.exported_at ? new Date(String(row.exported_at)).toISOString() : null,
    }));
  }

  async getBatchUnitBySerialHash(
    brand: string,
    batchId: string,
    serialHash: string,
  ): Promise<BatchUnitProvisionRecord | null> {
    const res = await this.pool.query(
      `SELECT * FROM batch_units WHERE brand = $1 AND batch_id = $2 AND serial_hash = $3`,
      [brand, batchId, serialHash],
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      unitId: String(row.unit_id),
      brand: String(row.brand),
      batchId: String(row.batch_id),
      serial: String(row.serial),
      serialHash: String(row.serial_hash),
      secretHash: String(row.secret_hash),
      encryptedSecret: row.encrypted_secret ? String(row.encrypted_secret) : null,
      proof: row.proof as string[],
      exportedAt: row.exported_at ? new Date(String(row.exported_at)).toISOString() : null,
    };
  }

  async purgeBatchSecrets(brand: string, batchId: string): Promise<void> {
    await this.pool.query(
      `UPDATE batch_units SET encrypted_secret = NULL, exported_at = NOW() WHERE brand = $1 AND batch_id = $2`,
      [brand, batchId],
    );
  }

  async markBatchRecalled(brand: string, batchId: string, reasonHash: string): Promise<void> {
    await this.pool.query(
      `UPDATE batches SET recalled = TRUE, recall_reason_hash = $3 WHERE brand = $1 AND batch_id = $2`,
      [brand, batchId, reasonHash],
    );
    await this.pool.query(
      `UPDATE units SET status = 'Recalled', updated_at = NOW() WHERE brand = $1 AND batch_id = $2 AND status = 'Active'`,
      [brand, batchId],
    );
  }

  async upsertUnit(unit: UnitRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO units (unit_id, brand, batch_id, owner, status, activated_at, warranty_expiry, claims_used, duplicate_attempts, scan_count, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
       ON CONFLICT (unit_id) DO UPDATE
       SET owner = EXCLUDED.owner,
           status = EXCLUDED.status,
           claims_used = EXCLUDED.claims_used,
           duplicate_attempts = EXCLUDED.duplicate_attempts,
           updated_at = NOW()`,
      [
        unit.unitId,
        unit.brand,
        unit.batchId,
        unit.owner,
        unit.status,
        unit.activatedAt,
        unit.warrantyExpiry,
        unit.claimsUsed,
        unit.duplicateAttempts,
        unit.scanCount,
      ],
    );
  }

  async getUnit(unitId: string): Promise<UnitRecord | null> {
    const res = await this.pool.query(`SELECT * FROM units WHERE unit_id = $1`, [unitId]);
    const row = res.rows[0];
    if (!row) return null;
    return {
      unitId: String(row.unit_id),
      brand: String(row.brand),
      batchId: String(row.batch_id),
      owner: String(row.owner),
      status: String(row.status) as UnitRecord["status"],
      activatedAt: Number(row.activated_at),
      warrantyExpiry: Number(row.warranty_expiry),
      claimsUsed: Number(row.claims_used),
      duplicateAttempts: Number(row.duplicate_attempts),
      scanCount: Number(row.scan_count),
    };
  }

  async listOwnerUnits(owner: string): Promise<UnitRecord[]> {
    const res = await this.pool.query(
      `SELECT * FROM units WHERE owner = $1 ORDER BY activated_at DESC`,
      [owner],
    );
    return res.rows.map((row) => ({
      unitId: String(row.unit_id),
      brand: String(row.brand),
      batchId: String(row.batch_id),
      owner: String(row.owner),
      status: String(row.status) as UnitRecord["status"],
      activatedAt: Number(row.activated_at),
      warrantyExpiry: Number(row.warranty_expiry),
      claimsUsed: Number(row.claims_used),
      duplicateAttempts: Number(row.duplicate_attempts),
      scanCount: Number(row.scan_count),
    }));
  }

  async recordScan(unitId: string, ipHash: string, uaHash: string): Promise<number> {
    await this.pool.query(
      `INSERT INTO scans (unit_id, ip_hash, ua_hash) VALUES ($1, $2, $3)`,
      [unitId, ipHash, uaHash],
    );
    await this.pool.query(
      `UPDATE units SET scan_count = scan_count + 1 WHERE unit_id = $1`,
      [unitId],
    );
    const countRes = await this.pool.query(
      `SELECT COUNT(*)::bigint AS total FROM scans WHERE unit_id = $1`,
      [unitId],
    );
    return Number(countRes.rows[0]?.total ?? 1);
  }

  async appendEvent(event: UnitEventRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO unit_events (id, unit_id, brand, batch_id, type, data, ledger, tx_hash, finalized, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET finalized = EXCLUDED.finalized`,
      [
        event.id,
        event.unitId,
        event.brand,
        event.batchId,
        event.type,
        JSON.stringify(event.data),
        event.ledger,
        event.txHash,
        event.finalized,
        event.createdAt,
      ],
    );
  }

  async getUnitEvents(unitId: string): Promise<UnitEventRecord[]> {
    const res = await this.pool.query(
      `SELECT * FROM unit_events WHERE unit_id = $1 ORDER BY ledger ASC, created_at ASC`,
      [unitId],
    );
    return res.rows.map((row) => ({
      id: String(row.id),
      unitId: row.unit_id ? String(row.unit_id) : null,
      brand: row.brand ? String(row.brand) : null,
      batchId: row.batch_id ? String(row.batch_id) : null,
      type: String(row.type),
      data: (row.data ?? {}) as Record<string, unknown>,
      ledger: Number(row.ledger),
      txHash: String(row.tx_hash),
      finalized: Boolean(row.finalized),
      createdAt: new Date(String(row.created_at)).toISOString(),
    }));
  }

  async setTransferOffer(offer: TransferOfferCache): Promise<void> {
    this.offers.set(offer.unitId, { ...offer });
  }

  async getTransferOffer(unitId: string): Promise<TransferOfferCache | null> {
    return this.offers.get(unitId) ?? null;
  }

  async deleteTransferOffer(unitId: string): Promise<void> {
    this.offers.delete(unitId);
  }

  async upsertClaim(claim: ClaimRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO claims (unit_id, claim_id, service_center, outcome, report_hash, filed_at, resolved_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (unit_id, claim_id) DO UPDATE
       SET outcome = EXCLUDED.outcome, report_hash = EXCLUDED.report_hash, resolved_at = EXCLUDED.resolved_at`,
      [
        claim.unitId,
        claim.claimId,
        claim.serviceCenter,
        claim.outcome,
        claim.reportHash,
        claim.filedAt,
        claim.resolvedAt,
      ],
    );
  }

  async getClaim(unitId: string, claimId: number): Promise<ClaimRecord | null> {
    const res = await this.pool.query(
      `SELECT * FROM claims WHERE unit_id = $1 AND claim_id = $2`,
      [unitId, claimId],
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      unitId: String(row.unit_id),
      claimId: Number(row.claim_id),
      serviceCenter: String(row.service_center),
      outcome: String(row.outcome) as ClaimRecord["outcome"],
      reportHash: String(row.report_hash),
      filedAt: Number(row.filed_at),
      resolvedAt: row.resolved_at !== null ? Number(row.resolved_at) : null,
    };
  }

  async listUnitClaims(unitId: string): Promise<ClaimRecord[]> {
    const res = await this.pool.query(
      `SELECT * FROM claims WHERE unit_id = $1 ORDER BY claim_id ASC`,
      [unitId],
    );
    return res.rows.map((row) => ({
      unitId: String(row.unit_id),
      claimId: Number(row.claim_id),
      serviceCenter: String(row.service_center),
      outcome: String(row.outcome) as ClaimRecord["outcome"],
      reportHash: String(row.report_hash),
      filedAt: Number(row.filed_at),
      resolvedAt: row.resolved_at !== null ? Number(row.resolved_at) : null,
    }));
  }

  async listServiceCenterClaims(serviceCenter: string): Promise<ClaimRecord[]> {
    const res = await this.pool.query(
      `SELECT * FROM claims WHERE service_center = $1 ORDER BY filed_at DESC`,
      [serviceCenter],
    );
    return res.rows.map((row) => ({
      unitId: String(row.unit_id),
      claimId: Number(row.claim_id),
      serviceCenter: String(row.service_center),
      outcome: String(row.outcome) as ClaimRecord["outcome"],
      reportHash: String(row.report_hash),
      filedAt: Number(row.filed_at),
      resolvedAt: row.resolved_at !== null ? Number(row.resolved_at) : null,
    }));
  }

  async saveFileMetadata(file: FileMetadataRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO files (hash, uploader, mime, size, storage_key, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (hash) DO NOTHING`,
      [file.hash, file.uploader, file.mime, file.size, file.storageKey, file.createdAt],
    );
  }

  async getFileMetadata(hash: string): Promise<FileMetadataRecord | null> {
    const res = await this.pool.query(`SELECT * FROM files WHERE hash = $1`, [hash]);
    const row = res.rows[0];
    if (!row) return null;
    return {
      hash: String(row.hash),
      uploader: String(row.uploader),
      mime: String(row.mime),
      size: Number(row.size),
      storageKey: String(row.storage_key),
      createdAt: new Date(String(row.created_at)).toISOString(),
    };
  }
}
