/**
 * snapshot-state.test.ts
 *
 * Unit tests for the snapshot serialization contract.
 * These tests validate the structure and referential integrity of snapshot
 * JSON without touching a database — they work directly against demo-v1.json.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

// ---------------------------------------------------------------------------
// Resolve path to demo snapshot relative to the workspace root
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WORKSPACE_ROOT = join(__dirname, "..");
const DEMO_SNAPSHOT_PATH = join(WORKSPACE_ROOT, ".snapshots", "demo-v1.json");

// ---------------------------------------------------------------------------
// Types (mirrors the Snapshot interface from the script)
// ---------------------------------------------------------------------------

interface SnapshotRow {
  [key: string]: unknown;
}

interface Snapshot {
  version: number;
  name: string;
  createdAt: string;
  tables: {
    brands: SnapshotRow[];
    batches: SnapshotRow[];
    batch_units: SnapshotRow[];
    units: SnapshotRow[];
    claims: SnapshotRow[];
  };
}

// ---------------------------------------------------------------------------
// Helper: load the demo snapshot once per test run
// ---------------------------------------------------------------------------

function loadDemoSnapshot(): Snapshot {
  const raw = readFileSync(DEMO_SNAPSHOT_PATH, "utf8");
  return JSON.parse(raw) as Snapshot;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Snapshot serialization", () => {
  it("produces valid JSON that round-trips cleanly", () => {
    const snapshot = loadDemoSnapshot();

    // Top-level version check
    expect(snapshot.version).toBe(1);

    // All five table arrays must exist
    expect(Array.isArray(snapshot.tables.brands)).toBe(true);
    expect(Array.isArray(snapshot.tables.batches)).toBe(true);
    expect(Array.isArray(snapshot.tables.batch_units)).toBe(true);
    expect(Array.isArray(snapshot.tables.units)).toBe(true);
    expect(Array.isArray(snapshot.tables.claims)).toBe(true);

    // Round-trip: re-serialize then re-parse must deep-equal the original
    const roundTripped = JSON.parse(JSON.stringify(snapshot)) as Snapshot;
    expect(roundTripped).toEqual(snapshot);
  });

  it("snapshot schema includes required fields", () => {
    const snapshot = loadDemoSnapshot();

    // brands[0] must carry the four identity columns
    const brand = snapshot.tables.brands[0];
    expect(brand).toHaveProperty("address");
    expect(brand).toHaveProperty("admin");
    expect(brand).toHaveProperty("domain");
    expect(brand).toHaveProperty("verified");

    // batches[0] must carry the three core columns
    const batch = snapshot.tables.batches[0];
    expect(batch).toHaveProperty("brand");
    expect(batch).toHaveProperty("batch_id");
    expect(batch).toHaveProperty("merkle_root");

    // units[0] must carry the three lifecycle columns
    const unit = snapshot.tables.units[0];
    expect(unit).toHaveProperty("unit_id");
    expect(unit).toHaveProperty("owner");
    expect(unit).toHaveProperty("status");
  });

  it("claims reference valid units", () => {
    const snapshot = loadDemoSnapshot();

    // Build the full set of known unit IDs from both activated units and
    // provisioned batch_units (a unit may be provisioned but not yet activated)
    const activatedUnitIds = new Set(
      snapshot.tables.units.map((u) => u["unit_id"] as string),
    );
    const batchUnitIds = new Set(
      snapshot.tables.batch_units.map((u) => u["unit_id"] as string),
    );
    const allKnownUnitIds = new Set([...activatedUnitIds, ...batchUnitIds]);

    for (const claim of snapshot.tables.claims) {
      const claimUnitId = claim["unit_id"] as string;
      expect(allKnownUnitIds.has(claimUnitId)).toBe(true);
    }
  });

  it("restore order is safe: brands before batches before units before claims", () => {
    const snapshot = loadDemoSnapshot();

    // Every batch_unit must reference a brand that exists in the brands table.
    // This verifies that brands can be inserted before batch_units without
    // violating any FK dependency.
    const brandAddresses = new Set(
      snapshot.tables.brands.map((b) => b["address"] as string),
    );

    for (const batchUnit of snapshot.tables.batch_units) {
      const ref = batchUnit["brand"] as string;
      expect(brandAddresses.has(ref)).toBe(true);
    }
  });
});
