import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadConfig } from "../config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    const schemaSql = await readFile(join(__dirname, "schema.sql"), "utf8");
    await pool.query(schemaSql);
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = loadConfig();
  runMigrations(cfg.databaseUrl)
    .then(() => {
      console.log("Database migrations applied successfully.");
    })
    .catch((err: unknown) => {
      console.error("Migration failed:", err);
      process.exit(1);
    });
}
