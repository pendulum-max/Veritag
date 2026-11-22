#!/usr/bin/env tsx
/**
 * snapshot-state.ts
 *
 * Dumps the five core Veritag DB tables into a versioned JSON file under .snapshots/.
 *
 * Usage:
 *   tsx scripts/snapshot-state.ts <name>
 *
 * Example:
 *   tsx scripts/snapshot-state.ts pre-deploy-v2
 */

import pg from "pg";
import { mkdir, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Snapshot {
  version: 1;
  name: string;
  createdAt: string; // ISO timestamp
  tables: {
    brands: unknown[];
    batches: unknown[];
    batch_units: unknown[];
    units: unknown[];
    claims: unknown[];
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WORKSPACE_ROOT = join(__dirname, "..");

function usage(): never {
  console.error("Usage: tsx scripts/snapshot-state.ts <name>");
  process.exit(1);
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

  const snapshotsDir = join(WORKSPACE_ROOT, ".snapshots");
  const outFile = join(snapshotsDir, `${name}.json`);

  const pool = new pg.Pool({ connectionString: databaseUrl });

  try {
    // Ensure output directory exists
    await mkdir(snapshotsDir, { recursive: true });

    // Query each table
    const [brandsRes, batchesRes, batchUnitsRes, unitsRes, claimsRes] = await Promise.all([
      pool.query("SELECT * FROM brands ORDER BY created_at"),
      pool.query("SELECT * FROM batches ORDER BY created_at"),
      pool.query("SELECT * FROM batch_units ORDER BY created_at"),
      pool.query("SELECT * FROM units ORDER BY activated_at"),
      pool.query("SELECT * FROM claims ORDER BY filed_at"),
    ]);

    const snapshot: Snapshot = {
      version: 1,
      name,
      createdAt: new Date().toISOString(),
      tables: {
        brands: brandsRes.rows,
        batches: batchesRes.rows,
        batch_units: batchUnitsRes.rows,
        units: unitsRes.rows,
        claims: claimsRes.rows,
      },
    };

    await writeFile(outFile, JSON.stringify(snapshot, null, 2), "utf8");

    const { brands, batches, batch_units, units, claims } = snapshot.tables;
    console.log(
      `Snapshot saved to .snapshots/${name}.json` +
        ` (brands: ${brands.length},` +
        ` batches: ${batches.length},` +
        ` batch_units: ${batch_units.length},` +
        ` units: ${units.length},` +
        ` claims: ${claims.length})`,
    );
  } catch (err) {
    console.error("Error creating snapshot:", err);
    await pool.end();
    process.exit(1);
  }

  await pool.end();
}

main();
