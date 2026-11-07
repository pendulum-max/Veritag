-- Veritag PostgreSQL Schema
-- Idempotent migration script matching Soroban Registry state and event history

CREATE TABLE IF NOT EXISTS brands (
  address TEXT PRIMARY KEY,
  admin TEXT NOT NULL,
  domain TEXT NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS service_centers (
  brand TEXT NOT NULL REFERENCES brands(address) ON DELETE CASCADE,
  service_center TEXT NOT NULL,
  authorized BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (brand, service_center)
);

CREATE TABLE IF NOT EXISTS batches (
  brand TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  merkle_root TEXT NOT NULL,
  warranty_months INTEGER NOT NULL,
  product_meta_hash TEXT NOT NULL,
  unit_count BIGINT NOT NULL,
  recalled BOOLEAN NOT NULL DEFAULT FALSE,
  recall_reason_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (brand, batch_id)
);

CREATE TABLE IF NOT EXISTS batch_units (
  unit_id TEXT PRIMARY KEY,
  brand TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  serial TEXT NOT NULL,
  serial_hash TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  encrypted_secret TEXT,
  proof JSONB NOT NULL,
  exported_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (brand, batch_id, serial_hash)
);

CREATE TABLE IF NOT EXISTS units (
  unit_id TEXT PRIMARY KEY,
  brand TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  owner TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Active',
  activated_at BIGINT NOT NULL,
  warranty_expiry BIGINT NOT NULL,
  claims_used INTEGER NOT NULL DEFAULT 0,
  duplicate_attempts INTEGER NOT NULL DEFAULT 0,
  scan_count BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_units_owner ON units(owner);
CREATE INDEX IF NOT EXISTS idx_units_brand_batch ON units(brand, batch_id);

CREATE TABLE IF NOT EXISTS unit_events (
  id TEXT PRIMARY KEY,
  unit_id TEXT,
  brand TEXT,
  batch_id TEXT,
  type TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  ledger BIGINT NOT NULL,
  tx_hash TEXT NOT NULL,
  finalized BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_unit_events_unit_id ON unit_events(unit_id, ledger ASC);

CREATE TABLE IF NOT EXISTS claims (
  unit_id TEXT NOT NULL,
  claim_id INTEGER NOT NULL,
  service_center TEXT NOT NULL,
  outcome TEXT NOT NULL DEFAULT 'Pending',
  report_hash TEXT NOT NULL DEFAULT '',
  filed_at BIGINT NOT NULL,
  resolved_at BIGINT,
  PRIMARY KEY (unit_id, claim_id)
);

CREATE INDEX IF NOT EXISTS idx_claims_service_center ON claims(service_center, outcome);

CREATE TABLE IF NOT EXISTS files (
  hash TEXT PRIMARY KEY,
  uploader TEXT NOT NULL,
  mime TEXT NOT NULL,
  size BIGINT NOT NULL,
  storage_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scans (
  id BIGSERIAL PRIMARY KEY,
  unit_id TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  ua_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scans_unit_id ON scans(unit_id, created_at DESC);

CREATE TABLE IF NOT EXISTS indexer_state (
  id TEXT PRIMARY KEY,
  last_ledger BIGINT NOT NULL DEFAULT 0,
  last_cursor TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
