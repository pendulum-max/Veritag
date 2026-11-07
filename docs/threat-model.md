# Veritag Threat Model

This document expands on the security properties, trust boundaries, and mitigations implemented across the Veritag contract, backend relayer, indexer, and client applications.

## Trust Assumptions

1. **Stellar Soroban Consensus:** Assumed honest-majority and Byzantine-fault-tolerant for transaction finality, `require_auth` signature verification, and ledger timestamps.
2. **Backend & Database:** Treated as **untrusted for authenticity and ownership**. Even if PostgreSQL or the REST backend is compromised or offline, it cannot forge a Merkle batch commitment, transfer an owned unit without the owner's signature, or erase past on-chain events.
3. **Registry Admin:** Trusted only to verify that a registering brand controls its claimed DNS domain via `https://<domain>/.well-known/stellar.toml`. Recommended to be a Stellar multisig account in production.

---

## Attack Surfaces & Mitigations

### 1. QR Label Cloning & Mass Counterfeiting
- **Attack:** A counterfeiter photographs a genuine product's outer QR code in a retail store and prints 10,000 copies onto fake boxes.
- **Mitigations:**
  - **Batch Membership:** Invented serials fail Merkle verification (`VerifyStatus::Unknown`).
  - **Hidden Scratch-Off Secret:** `activate` requires the raw `secret` printed inside sealed packaging or beneath a tamper-evident scratch layer. Outer QR links never contain the secret.
  - **Burn on First Claim:** Once activated, the `Unit` record exists permanently. Subsequent activation attempts fail with `UnitAlreadyActivated`, while `report_duplicate_attempt` increments `duplicate_attempts` on-chain and triggers a public warning banner.
  - **Scan Telemetry:** Every public scan increments `scan_count`. Abnormal scan counts (>50 scans on an unclaimed item) surface a high-visibility cloning alert.

### 2. Activation Front-Running
- **Attack:** An attacker observes a pending `activate` transaction in the mempool, extracts `(serial_hash, proof, secret)`, and submits a competing transaction setting `first_owner` to the attacker's address.
- **Mitigation:** `VeritagRegistry::activate` enforces `first_owner.require_auth()`. A transaction signed by Alice cannot be re-targeted to Bob, and user activation requests travel directly to the fee-sponsoring relayer over TLS rather than gossiping unsigned secrets.

### 3. Pre-Shipment Merkle Secret Leakage
- **Attack:** Database compromise at the brand middleware exposes raw scratch-off secrets prior to retail sale.
- **Mitigations:**
  - Secrets are encrypted at rest with AES-256-GCM (`backend/src/services/merkle.ts`) immediately upon generation.
  - Print-line export (`GET /v1/brands/batches/:id/export?purge=true`) wipes `encrypted_secret` columns immediately after factory export (`410 Gone` on any subsequent export attempt), leaving only public `serial_hash`, `secret_hash`, and Merkle `proof` hashes in storage.

### 4. Fee Sponsor Account Draining
- **Attack:** Bots spam `/v1/activate` or `/v1/sponsor` to exhaust the sponsor account's XLM balance, or wrap arbitrary XLM `payment` operations inside sponsored transactions.
- **Mitigations:**
  - `StellarFeeSponsorService` inspects the inner transaction XDR and rejects any transaction with `!= 1` operation or any operation other than `invokeHostFunction`, `restoreFootprint`, or `extendFootprintTtl`.
  - Enforces a hard per-transaction stroop ceiling, per-account rolling stroop budget, per-IP rolling stroop budget, and `SlidingWindowRateLimiter` on public and authenticated write routes.

### 5. Brand Key Compromise & Rogue Service Centers
- **Attack:** A brand signing key or a third-party repair shop key is compromised.
- **Mitigations:**
  - Brands can rotate their operational signing key via `rotate_brand_admin(brand, new_admin)` while preserving their canonical `brand` address across all historical batches and QR URLs.
  - Service centers are scoped per-brand (`DataKey::ServiceCenter(brand, sc)`) and can be revoked instantaneously via `revoke_service_center`, which immediately blocks `file_claim` and `resolve_claim`.

### 6. Soroban State Archival
- **Attack / Operational Risk:** Persistent unit or batch records expire after multi-year warranties, causing verification or resale transfers to fail.
- **Mitigations:**
  - `activate` and all lifecycle mutations extend unit and batch TTLs to cover the remaining warranty plus a 90-day buffer (safely clamped to `env.storage().max_ttl()`).
  - Permissionless `bump_unit_ttl` and `bump_batch_ttl` entrypoints allow scheduled maintenance jobs to refresh long-lived warranties before archival.
