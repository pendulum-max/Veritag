# Veritag Backend REST API

Base URL: `http://localhost:4000`

Authenticated endpoints require `Authorization: Bearer <jwt>` obtained via either SEP-10 Ed25519 challenge-response (`G...` accounts) or Soroban `secp256r1` Passkey Smart Account challenge-response (`C...` accounts).

---

## Authentication & Passkey Wallets

### `POST /v1/auth/challenge`
Issues a short-lived challenge message for a Stellar `G...` Ed25519 account or Soroban `C...` Passkey Smart Account.

### `POST /v1/auth/verify`
Verifies an Ed25519 signature (for `G...` accounts) or a P-256 / WebAuthn assertion (for `C...` accounts) and returns an HS256 bearer token.

### `POST /v1/wallets/passkey`
Validates a 65-byte uncompressed SEC1 P-256 public key, computes the deterministic Soroban contract address via `AccountFactoryContract`, relays `deploy`, persists the wallet mapping, and returns `{ wallet, deployTxHash, token }`.

### `GET /v1/wallets/passkey/:credentialId`
Looks up an existing Passkey Smart Account by WebAuthn credential ID.

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

### `GET /v1/brands/me` *(Brand Auth)*
Returns the brand profile, `stellar.toml` verification status, authorized service centers, and batch count.

### `POST /v1/brands/register` *(Brand Auth)*
Registers or updates the brand's domain metadata.

### `POST /v1/brands/verify-domain` *(Brand Auth)*
Fetches `https://<domain>/.well-known/stellar.toml` (with SSRF private-IP blocking), verifies that the brand's Stellar address appears in `SIGNING_KEY` or `ACCOUNTS`, marks the brand verified, and relays `VeritagRegistry::verify_brand` on-chain.

### `POST /v1/brands/service-centers` *(Brand Auth)*
Authorizes or revokes a service center address for the brand.

### `POST /v1/brands/batches` *(Brand Auth)*
Generates serials, creates 128-bit scratch-off secrets, builds the sorted-pair SHA-256 Merkle tree, stores AES-256-GCM encrypted secrets for printing, and returns ready-to-sign `commit_batch` parameters.

### `GET /v1/brands/batches/:id/export?format=csv|json&purge=true|false&qrSvg=true|false` *(Brand Auth)*
Exports `(unit_id, serial, scratch_secret, qr_url, qr_svg, qr_data_url, serial_hash)` for factory label printing. When `purge=true`, permanently deletes encrypted secrets from backend storage (`410 Gone` on subsequent calls).

### `POST /v1/brands/recall` *(Brand Auth)*
Recalls an entire batch (`mode: "batch"`) or flags a single compromised unit (`mode: "unit"`).

---

## Consumer, Service Center & Maintenance Endpoints

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/v1/activate` | Public (rate-limited) | Verifies Merkle proof & secret; activates unit or records `duplicate_attempt`. |
| `POST` | `/v1/transfer/offer` | Owner | Creates a time-bounded one-time resale transfer code. |
| `POST` | `/v1/transfer/redeem` | New Owner | Redeems transfer code and transfers remaining warranty. |
| `POST` | `/v1/claims` | Owner | Files a warranty claim with an authorized service center. |
| `POST` | `/v1/claims/:id/resolve` | Service Center | Resolves claim (`Approved`, `Rejected`, `Repaired`, `Replaced`) with report hash. |
| `POST` | `/v1/files` | Authenticated | Uploads receipt or service report (`<= 10MB`); returns SHA-256 hash. |
| `GET` | `/v1/files/:hash` | Public | Downloads content-addressed file with `X-Content-Type-Options: nosniff`. |
| `POST` | `/v1/sponsor` | Authenticated | Wraps a Soroban tx in a sponsored `FeeBumpTransaction` (and optionally submits to RPC). |
| `POST` | `/v1/maintenance/ttl-sweep` | Authenticated | Runs an on-demand TTL extension sweep across active batches and units. |
