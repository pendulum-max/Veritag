#!/usr/bin/env tsx
/**
 * restore-state.ts
 *
 * Restores a Veritag DB snapshot created by snapshot-state.ts.
 * All five tables are wiped and re-populated inside a single transaction,
 * respecting FK constraints (delete leaf → root, insert root → leaf).
 *
 * Usage:
 *   tsx scripts/restore-state.ts <name>
 *
 * Example:
 *   tsx scripts/restore-state.ts pre-deploy-v2
 */

import pg from "pg";
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Snapshot {
  version: 1;
  name: string;
  createdAt: string;
  tables: {
    brands: Record<string, unknown>[];
    batches: Record<string, unknown>[];
    batch_units: Record<string, unknown>[];
    units: Record<string, unknown>[];
    claims: Record<string, unknown>[];
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WORKSPACE_ROOT = join(__dirname, "..");

function usage(): never {
  console.error("Usage: tsx scripts/restore-state.ts <name>");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Per-table INSERT helpers (parameterized, upsert-safe)
// ---------------------------------------------------------------------------

async function insertBrands(
  client: pg.PoolClient,
  rows: Record<string, unknown>[],
): Promise<void> {
  for (const row of rows) {
    await client.query(
      `INSERT INTO brands (address, admin, domain, verified, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (address) DO UPDATE
         SET admin    = EXCLUDED.admin,
             domain   = EXCLUDED.domain,
             verified = EXCLUDED.verified`,
      [row["address"], row["admin"], row["domain"], row["verified"], row["created_at"]],
    );
  }
}

async function insertBatches(
  client: pg.PoolClient,
  rows: Record<string, unknown>[],
): Promise<void> {
  for (const row of rows) {
    await client.query(
      `INSERT INTO batches
         (brand, batch_id, merkle_root, warranty_months, product_meta_hash,
          unit_count, recalled, recall_reason_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (brand, batch_id) DO UPDATE
         SET merkle_root        = EXCLUDED.merkle_root,
             warranty_months    = EXCLUDED.warranty_months,
             product_meta_hash  = EXCLUDED.product_meta_hash,
             unit_count         = EXCLUDED.unit_count,
             recalled           = EXCLUDED.recalled,
             recall_reason_hash = EXCLUDED.recall_reason_hash`,
      [
        row["brand"],
        row["batch_id"],
        row["merkle_root"],
        row["warranty_months"],
        row["product_meta_hash"],
        row["unit_count"],
        row["recalled"],
        row["recall_reason_hash"] ?? null,
        row["created_at"],
      ],
    );
  }
}

async function insertBatchUnits(
  client: pg.PoolClient,
  rows: Record<string, unknown>[],
): Promise<void> {
  for (const row of rows) {
    // proof may be stored as a parsed array or a JSON string
    const proof =
      typeof row["proof"] === "string" ? row["proof"] : JSON.stringify(row["proof"]);

    await client.query(
      `INSERT INTO batch_units
         (unit_id, brand, batch_id, serial, serial_hash, secret_hash,
          encrypted_secret, proof, exported_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
       ON CONFLICT (unit_id) DO UPDATE
         SET brand            = EXCLUDED.brand,
             batch_id         = EXCLUDED.batch_id,
             serial           = EXCLUDED.serial,
             serial_hash      = EXCLUDED.serial_hash,
             secret_hash      = EXCLUDED.secret_hash,
             encrypted_secret = EXCLUDED.encrypted_secret,
             proof            = EXCLUDED.proof,
             exported_at      = EXCLUDED.exported_at`,
      [
        row["unit_id"],
        row["brand"],
        row["batch_id"],
        row["serial"],
        row["serial_hash"],
        row["secret_hash"],
        row["encrypted_secret"] ?? null,
        proof,
        row["exported_at"] ?? null,
        row["created_at"],
      ],
    );
  }
}

async function insertUnits(
  client: pg.PoolClient,
  rows: Record<string, unknown>[],
): Promise<void> {
  for (const row of rows) {
    await client.query(
      `INSERT INTO units
         (unit_id, brand, batch_id, owner, status, activated_at, warranty_expiry,
          claims_used, duplicate_attempts, scan_count, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (unit_id) DO UPDATE
         SET brand              = EXCLUDED.brand,
             batch_id           = EXCLUDED.batch_id,
             owner              = EXCLUDED.owner,
             status             = EXCLUDED.status,
             activated_at       = EXCLUDED.activated_at,
             warranty_expiry    = EXCLUDED.warranty_expiry,
             claims_used        = EXCLUDED.claims_used,
             duplicate_attempts = EXCLUDED.duplicate_attempts,
             scan_count         = EXCLUDED.scan_count,
             updated_at         = EXCLUDED.updated_at`,
      [
        row["unit_id"],
        row["brand"],
        row["batch_id"],
        row["owner"],
        row["status"],
        row["activated_at"],
        row["warranty_expiry"],
        row["claims_used"],
        row["duplicate_attempts"],
        row["scan_count"],
        row["updated_at"] ?? new Date().toISOString(),
      ],
    );
  }
}

async function insertClaims(
  client: pg.PoolClient,
  rows: Record<string, unknown>[],
): Promise<void> {
  for (const row of rows) {
    await client.query(
      `INSERT INTO claims
         (unit_id, claim_id, service_center, outcome, report_hash, filed_at, resolved_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (unit_id, claim_id) DO UPDATE
         SET service_center = EXCLUDED.service_center,
             outcome        = EXCLUDED.outcome,
             report_hash    = EXCLUDED.report_hash,
             filed_at       = EXCLUDED.filed_at,
             resolved_at    = EXCLUDED.resolved_at`,
      [
        row["unit_id"],
        row["claim_id"],
        row["service_center"],
        row["outcome"],
        row["report_hash"],
        row["filed_at"],
        row["resolved_at"] ?? null,
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const name = process.argv[2];
  if (!name || name.trim() === "") {
    console.error("Error: snapshot name is required.");
    usage();
  }

  const databaseUrl =
    process.env["DATABASE_URL"] ?? "postgres://veritag:veritag@localhost:5432/veritag";

  const snapshotFile = join(WORKSPACE_ROOT, ".snapshots", `${name}.json`);

  // Read and parse snapshot
  let snapshot: Snapshot;
  try {
    const raw = await readFile(snapshotFile, "utf8");
    snapshot = JSON.parse(raw) as Snapshot;
  } catch (err) {
    console.error(`Error reading snapshot file '${snapshotFile}':`, err);
    process.exit(1);
  }

  if (snapshot.version !== 1) {
    console.error(
      `Error: unsupported snapshot version '${snapshot.version}'. Only version 1 is supported.`,
    );
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // -----------------------------------------------------------------------
    // DELETE in reverse FK order: leaf tables first, root tables last
    // claims → units → batch_units → batches → brands
    // -----------------------------------------------------------------------
    await client.query("DELETE FROM claims");
    await client.query("DELETE FROM units");
    await client.query("DELETE FROM batch_units");
    await client.query("DELETE FROM batches");
    await client.query("DELETE FROM brands");

    // -----------------------------------------------------------------------
    // INSERT in FK-safe order: root tables first, leaf tables last
    // brands → batches → batch_units → units → claims
    // -----------------------------------------------------------------------
    await insertBrands(client, snapshot.tables.brands);
    await insertBatches(client, snapshot.tables.batches);
    await insertBatchUnits(client, snapshot.tables.batch_units);
    await insertUnits(client, snapshot.tables.units);
    await insertClaims(client, snapshot.tables.claims);

    await client.query("COMMIT");

    const { brands, batches, batch_units, units, claims } = snapshot.tables;
    console.log(
      `Restored snapshot '${name}'` +
        ` (brands: ${brands.length},` +
        ` batches: ${batches.length},` +
        ` batch_units: ${batch_units.length},` +
        ` units: ${units.length},` +
        ` claims: ${claims.length})`,
    );
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error restoring snapshot (transaction rolled back):", err);
    client.release();
    await pool.end();
    process.exit(1);
  }

  client.release();
  await pool.end();
}

main();
