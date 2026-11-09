import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadConfig } from "../config.js";

export interface MigrationResult {
  version: string;
  checksum: string;
  applied: boolean;
}

const DEFAULT_MIGRATION_VERSION = "001_initial_schema";

export function resolveDefaultSchemaPath(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return join(currentDir, "schema.sql");
}

/**
 * Applies `schema.sql` idempotently inside a PostgreSQL transaction and records
 * the applied SHA-256 checksum in `schema_migrations`.
 */
export async function runDatabaseMigrations(
  databaseUrlOrPool: string | pg.Pool,
  schemaPath = resolveDefaultSchemaPath(),
): Promise<MigrationResult> {
  const ownsPool = typeof databaseUrlOrPool === "string";
  const pool = ownsPool ? new pg.Pool({ connectionString: databaseUrlOrPool }) : databaseUrlOrPool;

  const sql = readFileSync(schemaPath, "utf8");
  const checksum = createHash("sha256").update(sql).digest("hex");

  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `CREATE TABLE IF NOT EXISTS schema_migrations (
           version TEXT PRIMARY KEY,
           checksum TEXT NOT NULL,
           applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
         )`,
      );

      const existing = await client.query(
        `SELECT checksum FROM schema_migrations WHERE version = $1`,
        [DEFAULT_MIGRATION_VERSION],
      );
      const existingChecksum = existing.rows[0]?.checksum
        ? String(existing.rows[0].checksum)
        : null;

      if (existingChecksum === checksum) {
        await client.query("COMMIT");
        return {
          version: DEFAULT_MIGRATION_VERSION,
          checksum,
          applied: false,
        };
      }

      await client.query(sql);
      await client.query(
        `INSERT INTO schema_migrations (version, checksum, applied_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (version) DO UPDATE
         SET checksum = EXCLUDED.checksum, applied_at = NOW()`,
        [DEFAULT_MIGRATION_VERSION, checksum],
      );
      await client.query("COMMIT");

      return {
        version: DEFAULT_MIGRATION_VERSION,
        checksum,
        applied: true,
      };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } finally {
    if (ownsPool) {
      await pool.end();
    }
  }
}

const isMainModule =
  process.argv[1] &&
  fileURLToPath(import.meta.url).endsWith(process.argv[1].replace(/^.*\/src\//, "/src/"));

if (isMainModule) {
  const config = loadConfig();
  runDatabaseMigrations(config.databaseUrl)
    .then((res) => {
      console.log(
        res.applied
          ? `Applied migration ${res.version} (checksum ${res.checksum.slice(0, 12)}...)`
          : `Migration ${res.version} already up to date (checksum ${res.checksum.slice(0, 12)}...)`,
      );
    })
    .catch((err) => {
      console.error("Database migration failed:", err);
      process.exitCode = 1;
    });
}
