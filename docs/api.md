# Veritag Backend REST API

Base URL: `http://localhost:4000`

All authenticated endpoints require `Authorization: Bearer <jwt>` obtained via the SEP-10 wallet challenge-response flow.

---

## Authentication

### `POST /v1/auth/challenge`
Issues a short-lived challenge message for a Stellar Ed25519 account.

**Request:**
```json
{ "account": "GB7TAYRUZGE6TVT7NHP5SMIZRNQA6PLM423EYISAOAP3MKYIQMVYP2JO" }
```

**Response (`200 OK`):**
```json
{
  "nonce": "8f2d...",
  "account": "GB7T...",
  "message": "Veritag Authentication\nAccount: GB7T...\nNonce: 8f2d...\nExpires: 1700000300",
  "expiresAt": 1700000300
}
```

### `POST /v1/auth/verify`
Verifies the hex or base64 Ed25519 signature over `message` and returns an HS256 bearer token.

**Request:**
```json
{ "nonce": "8f2d...", "signature": "a41c..." }
```

---

## Public Verification & History

### `GET /v1/verify/:brand/:batch/:serial`
Computes `unit_id`, logs an anonymized scan (`ip_hash`, `ua_hash`), and returns aggregated verification state:
- `status`: `"AuthenticInactive" | "AuthenticActive" | "AlreadyClaimedWarning" | "Flagged" | "Recalled" | "Retired" | "Unknown"`
- `scanCount` and `suspiciousScanVolume`
- `brand`, `batch`, and anonymized `unit` warranty metadata.

### `GET /v1/units/:unitId`
Returns current unit status, warranty validity, filed claims, and ordered event timeline (`unit_activated`, `transfer_offered`, `unit_transferred`, `claim_filed`, `claim_resolved`, `unit_flagged`).

---

## Brand Operations

### `POST /v1/brands/batches` *(Brand Auth)*
Generates serials (or uses provided `serials`), creates 128-bit scratch-off secrets, builds the sorted-pair SHA-256 Merkle tree, stores AES-256-GCM encrypted secrets for printing, and returns ready-to-sign `commit_batch` parameters.

**Request:**
```json
{
  "batchCode": "CH-2026-LOT1",
  "warrantyMonths": 24,
  "productMeta": { "model": "Chronos Titan", "sku": "CT-01" },
  "count": 1000
}
```

### `GET /v1/brands/batches/:id/export?format=csv|json&purge=true|false` *(Brand Auth)*
Exports `(unit_id, serial, scratch_secret, qr_url, serial_hash)` for factory label printing. When `purge=true`, permanently deletes encrypted secrets from backend storage (`410 Gone` on subsequent calls).

### `POST /v1/brands/recall` *(Brand Auth)*
Recalls an entire batch (`mode: "batch"`) or flags a single compromised unit (`mode: "unit"`).

---

## Consumer & Service Center Lifecycle

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/v1/activate` | Public (rate-limited) | Verifies Merkle proof & secret; activates unit or records `duplicate_attempt`. |
| `POST` | `/v1/transfer/offer` | Owner | Creates a time-bounded one-time resale transfer code. |
| `POST` | `/v1/transfer/redeem` | New Owner | Redeems transfer code and transfers remaining warranty. |
| `POST` | `/v1/claims` | Owner | Files a warranty claim with an authorized service center. |
| `POST` | `/v1/claims/:id/resolve` | Service Center | Resolves claim (`Approved`, `Rejected`, `Repaired`, `Replaced`) with report hash. |
| `POST` | `/v1/files` | Authenticated | Uploads receipt or service report (`<= 10MB`); returns SHA-256 hash. |
| `POST` | `/v1/sponsor` | Authenticated | Wraps a Soroban `invokeHostFunction` / `restoreFootprint` tx in a sponsored `FeeBumpTransaction`. |
