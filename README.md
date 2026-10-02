# Veritag

**On-chain product authenticity and warranty registry on Stellar Soroban.**

Veritag lets manufacturers commit production batches to the Stellar blockchain, lets buyers verify that a product is genuine by scanning a QR code, and turns the warranty into a transferable, tamper-proof record that follows the product through resale. No paper receipts, no lost warranty cards, no guessing whether the "sealed" item is a fake.


---

## Table of Contents

1. [The Problem](#the-problem)
2. [The Solution](#the-solution)
3. [Why Stellar and Soroban](#why-stellar-and-soroban)
4. [Key Features](#key-features)
5. [How It Works](#how-it-works)
6. [Architecture](#architecture)
7. [Repository Structure](#repository-structure)
8. [Smart Contract Design](#smart-contract-design)
9. [Anti-Counterfeit Layers](#anti-counterfeit-layers)
10. [Backend API](#backend-api)
11. [Indexer](#indexer)
12. [Frontend](#frontend)
13. [Wallets and Fee Sponsorship](#wallets-and-fee-sponsorship)
14. [Privacy and Data Handling](#privacy-and-data-handling)
15. [State Archival and TTL Strategy](#state-archival-and-ttl-strategy)
16. [Threat Model](#threat-model)
17. [Getting Started](#getting-started)
18. [Configuration](#configuration)
19. [Deployment](#deployment)
20. [Testing](#testing)
21. [Roadmap](#roadmap)
22. [Contributing](#contributing)
23. [License](#license)

---

## The Problem

Counterfeit goods and lost warranty paperwork cost cross-border e-commerce billions every year.

- **Electronics:** fake chargers, batteries, phones and accessories that look identical to the real thing and sometimes cause fires.
- **Luxury goods:** counterfeits that fool buyers on resale marketplaces, where there is no way to prove provenance.
- **Pharmaceuticals:** falsified or diverted medicines that reach patients, with weak tracing across borders.
- **Warranties:** paper cards get lost, receipts fade, and warranty claims are denied because the second owner cannot prove purchase date or authenticity.

Existing solutions (holograms, serial lookup websites, brand-owned databases) are either easy to copy, controlled by a single party that can edit history, or unavailable once the brand shuts a site down.

## The Solution

1. At production, the manufacturer commits a **Merkle root** for a whole batch of serial numbers in a single transaction.
2. Each unit ships with a **QR code** (and optionally a hidden scratch-off secret or NFC chip).
3. On first sale or first scan, the unit is **activated** on-chain by submitting a Merkle proof. This creates its record lazily, so minting costs almost nothing even for low-margin goods.
4. Ownership and warranty **transfer on resale** through a one-time transfer code.
5. Warranty **claims** are validated against the unit's on-chain history by authorized service centers.
6. Brands can **flag units or recall whole batches**, which is critical for pharma and safety recalls.

Anyone can verify a product in seconds by scanning its QR code. The verification page reads directly from the chain, so it cannot be quietly edited by the brand or the platform.

## Why Stellar and Soroban

- **Low, predictable fees.** Per-unit operations cost a fraction of a cent, which makes the model viable for goods with thin margins.
- **Native smart contracts with Rust.** Soroban contracts are compiled to WASM, are testable with a built-in test environment, and have strong type safety.
- **Built-in cryptography.** SHA-256, Keccak-256 and secp256r1 signature verification are available as host functions, which supports Merkle proofs and passkey-based wallets.
- **Fee-bump transactions.** A sponsor can pay fees on behalf of users, so buyers never need to hold XLM.
- **Fast finality** (a few seconds), which suits a "scan and verify at the point of sale" experience.
- **Anchor and asset ecosystem.** Optional future integrations for warranty-backed payments or deposits using Stellar assets.

## Key Features

| Feature | Description |
|---|---|
| **Merkle batch commits** | One write per production batch, regardless of size. |
| **Lazy unit activation** | A unit record is created on first sale or claim, with a Merkle proof. |
| **Secret-based first claim** | A scratch-off secret defeats QR cloning; duplicate claims are flagged. |
| **Verified brands** | Brands are bound to a domain via `stellar.toml` and approved by a registry admin. |
| **Resale with warranty transfer** | One-time transfer codes let a seller hand over a unit and its remaining warranty. |
| **Claims workflow** | Service centers file and resolve claims, with limits and expiry enforced on-chain. |
| **Recalls and flags** | Brands can flag a unit or recall a whole batch; the verify page shows it instantly. |
| **Full history** | Every state change emits an event; the indexer builds a complete timeline. |
| **No-crypto UX** | Passkey smart wallets and fee sponsorship for consumers. |
| **Privacy by design** | Only hashes and addresses on-chain; documents live off-chain. |

## How It Works

### 1. Manufacturer onboarding

1. The brand registers on the registry contract with its domain name.
2. The brand publishes a `stellar.toml` at `https://<domain>/.well-known/stellar.toml` containing its Stellar account.
3. The registry admin (or a DAO or multisig) verifies the domain proof and approves the brand.

### 2. Production batch

1. The brand backend generates serial numbers and, for each unit, a random secret.
2. For each unit, it computes `leaf = sha256(serial_hash || secret_hash)`.
3. It builds a Merkle tree and calls `commit_batch(brand, batch_id, merkle_root, warranty_months, product_meta_hash)`.
4. Serials, secrets and QR payloads are exported to the printing line. Secrets are printed under a scratch-off layer or placed inside the packaging.

### 3. Verification (public)

1. A shopper scans the QR code, which opens `https://<app>/v/<brand>/<batch>/<serial>`.
2. The verify page queries the contract and shows one of:
   - **Authentic, not yet activated** (batch exists, unit not activated)
   - **Authentic, activated** (owner, warranty status, scan count)
   - **Already claimed** (potential duplicate or resold unit)
   - **Flagged or recalled**
   - **Unknown** (not in any committed batch, so likely counterfeit)

### 4. Activation (first sale)

1. The retailer or buyer reveals the secret and submits `activate(...)` with the Merkle proof.
2. The contract recomputes the leaf, verifies the proof against the batch root, and creates the unit record with the first owner and warranty expiry.
3. The secret is now burned. Any later activation attempt with the same unit fails and is logged as a duplicate attempt.

### 5. Resale and transfer

1. The seller creates a transfer offer with `create_transfer_offer(unit_id, code_hash, expires_at)` and gives the buyer a one-time code.
2. The buyer calls `redeem_transfer(unit_id, code, new_owner)`.
3. Ownership changes, the remaining warranty is preserved, and the event is appended to history.

### 6. Warranty claim

1. The owner calls `file_claim(unit_id, service_center)`.
2. The contract checks ownership, warranty expiry, unit status and claim limits.
3. The authorized service center calls `resolve_claim(unit_id, claim_id, outcome)`.
4. The outcome is permanent history that future buyers can see.

## Architecture

```
                         ┌──────────────────────────┐
                         │   Brand ERP / Factory    │
                         └────────────┬─────────────┘
                                      │ batch CSV / API
                                      ▼
┌────────────────┐   REST    ┌──────────────────────┐   Soroban RPC   ┌─────────────────────┐
│  Next.js App   │◄─────────►│   Backend (Node/TS)  │◄───────────────►│  Stellar Network    │
│  verify/owner/ │           │  batches, QR, relay, │                 │  Registry Contract  │
│  brand views   │           │  fee sponsorship     │                 └──────────┬──────────┘
└───────┬────────┘           └──────────┬───────────┘                            │ events
        │                               │                                        ▼
        │ direct read (RPC)             │                              ┌─────────────────────┐
        └───────────────────────────────┼─────────────────────────────►│  Indexer (getEvents)│
                                        ▼                              └──────────┬──────────┘
                              ┌──────────────────┐                                │
                              │    PostgreSQL    │◄───────────────────────────────┘
                              │ history, batches │
                              └──────────────────┘
                              ┌──────────────────┐
                              │ Object storage   │  invoices, receipts, service reports
                              │ (S3-compatible)  │  (hash stored on-chain)
                              └──────────────────┘
```

**Design principle:** the chain is the source of truth for authenticity and ownership. The backend and database are conveniences for speed, history and file storage, and anything important can be reconstructed from chain data.

## Repository Structure

```
veritag/
├── contracts/
│   └── registry/
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs            # contract entrypoints
│           ├── types.rs          # Brand, Batch, Unit, Claim, errors
│           ├── storage.rs        # storage keys and TTL helpers
│           ├── merkle.rs         # proof verification (sha256)
│           ├── events.rs         # event definitions
│           └── test.rs           # unit and integration tests
├── backend/
│   ├── src/
│   │   ├── routes/               # batches, units, claims, sponsor, files
│   │   ├── services/             # merkle, qr, relayer, storage, auth
│   │   ├── db/                   # schema and migrations
│   │   └── index.ts
│   └── package.json
├── indexer/
│   ├── src/
│   │   ├── poller.ts             # getEvents polling and cursor handling
│   │   ├── decoder.ts            # XDR to typed events
│   │   └── writer.ts             # idempotent Postgres writes
│   └── package.json
├── web/                          # Next.js app
│   ├── app/
│   │   ├── v/[brand]/[batch]/[serial]/   # public verify page
│   │   ├── owner/                        # my products, transfer, claims
│   │   └── brand/                        # dashboard, batches, recalls
│   ├── components/
│   ├── lib/                      # stellar SDK client, passkey helpers
│   └── package.json
├── packages/
│   └── sdk/                      # shared TypeScript client generated from contract spec
├── scripts/
│   ├── deploy-testnet.sh
│   ├── seed-demo.ts              # demo brand, batch and units
│   └── generate-bindings.sh
├── docs/
│   ├── architecture.md
│   ├── threat-model.md
│   └── api.md
├── docker-compose.yml            # postgres, backend, indexer, web
├── .env.example
└── README.md
```

## Smart Contract Design

### Core principles

- **One registry contract** handles all brands. Units are records, not separate token contracts, so there is no per-unit deployment cost.
- **Merkle batches** make minting effectively free: one root per batch.
- **Lazy activation** only writes unit state when something happens (first sale, transfer, claim).
- **Hashes, not raw data.** Serial numbers and metadata are stored as hashes.

### Identifiers

```
serial_hash = sha256(serial_bytes)
unit_id     = sha256(brand_address || batch_id || serial_hash)    // BytesN<32>
leaf        = sha256(serial_hash || secret_hash)
secret_hash = sha256(secret_bytes)
```

### Data types (Rust, simplified)

```rust
pub struct Brand {
    pub admin: Address,          // brand's signing account
    pub domain: String,          // verified via stellar.toml
    pub verified: bool,          // set by registry admin
}

pub struct Batch {
    pub brand: Address,
    pub merkle_root: BytesN<32>,
    pub warranty_months: u32,
    pub product_meta_hash: BytesN<32>,   // hash of off-chain product description
    pub unit_count: u64,
    pub created_at: u64,
    pub recalled: bool,
}

pub enum UnitStatus { Active, Flagged, Recalled, Retired }

pub struct Unit {
    pub batch_id: BytesN<32>,
    pub owner: Address,
    pub status: UnitStatus,
    pub activated_at: u64,
    pub warranty_expiry: u64,
    pub claims_used: u32,
    pub history_len: u32,
}

pub struct Claim {
    pub id: u32,
    pub service_center: Address,
    pub filed_at: u64,
    pub outcome: ClaimOutcome,          // Pending, Approved, Rejected, Repaired, Replaced
    pub report_hash: BytesN<32>,
}
```

### Contract interface

```
// Registry administration
init(admin)
register_brand(brand, domain)                          // brand auth
verify_brand(brand)                                    // registry admin only
register_service_center(brand, service_center)         // brand auth

// Production
commit_batch(brand, batch_id, merkle_root,
             warranty_months, product_meta_hash, unit_count)

// Lifecycle
activate(brand, batch_id, serial_hash, proof, secret, first_owner)
create_transfer_offer(unit_id, code_hash, expires_at)  // current owner auth
redeem_transfer(unit_id, code, new_owner)              // new owner auth
cancel_transfer_offer(unit_id)                         // current owner auth

// Warranty claims
file_claim(unit_id, service_center)                    // owner auth
resolve_claim(unit_id, claim_id, outcome, report_hash) // service center auth

// Safety and recalls
flag_unit(unit_id, reason_hash)                        // brand auth
recall_batch(brand, batch_id, reason_hash)             // brand auth

// Reads
get_brand(brand)
get_batch(brand, batch_id)
get_unit(unit_id) -> Option<UnitView>
verify_serial(brand, batch_id, serial_hash, proof, secret_hash) -> VerifyResult
is_warranty_valid(unit_id) -> bool
```

### Events

Every state change emits an event so the indexer can rebuild history:

| Event | Topics | Data |
|---|---|---|
| `brand_registered` | brand | domain |
| `brand_verified` | brand | |
| `batch_committed` | brand, batch_id | root, warranty_months, unit_count |
| `unit_activated` | unit_id | owner, warranty_expiry |
| `duplicate_attempt` | unit_id | caller |
| `transfer_offered` | unit_id | code_hash, expires_at |
| `unit_transferred` | unit_id | from, to |
| `claim_filed` | unit_id | claim_id, service_center |
| `claim_resolved` | unit_id | claim_id, outcome |
| `unit_flagged` | unit_id | reason_hash |
| `batch_recalled` | brand, batch_id | reason_hash |

### Error codes

```
NotAuthorized, BrandNotFound, BrandNotVerified, BatchExists, BatchNotFound,
InvalidProof, UnitAlreadyActivated, UnitNotFound, WarrantyExpired,
ClaimLimitReached, TransferOfferExpired, InvalidTransferCode,
UnitFlagged, BatchRecalled, ServiceCenterNotAuthorized
```

### Storage layout

| Key | Storage type | Notes |
|---|---|---|
| `Config` | Instance | admin, global settings |
| `Brand(Address)` | Persistent | |
| `Batch(Address, BytesN<32>)` | Persistent | extended at commit |
| `Unit(BytesN<32>)` | Persistent | TTL extended to cover warranty |
| `Offer(BytesN<32>)` | Temporary | expires with the offer |
| `Claim(BytesN<32>, u32)` | Persistent | |

## Anti-Counterfeit Layers

The QR code on its own is just a link, and links can be copied. Veritag layers defenses so that copying a code is either useless or immediately visible.

1. **Batch membership.** A serial that is not in a committed Merkle batch is not authentic. This stops invented serial numbers.
2. **Hidden secret (scratch-off or inside-pack).** The contract stores only the Merkle root, never secrets. Activation requires revealing the secret, so someone who photographs only the outside QR code cannot activate the unit.
3. **Burn on first claim.** Once activated, the unit's secret cannot be reused. A second activation attempt emits `duplicate_attempt` and the verify page shows a warning.
4. **Scan counter.** The verify page tracks and displays how many times a unit was scanned. A "new" unit scanned 400 times is suspicious.
5. **NFC with signed counters (luxury and high value).** Chips such as NTAG 424 DNA generate a unique, signed URL on every tap with a rolling counter. The backend verifies the signature and counter, which makes cloning of the tag content infeasible.
6. **Verified brand badge.** Only brands approved by the registry admin and bound to a domain are shown as verified, which stops fake brand registrations.
7. **Recall and flag.** Known-bad units or batches turn red everywhere immediately.

## Backend API

REST API implemented in TypeScript (Hono or Fastify). Authentication is via wallet-signed challenge (SEP-10 style) for brands, and anonymous for public reads.

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/v1/verify/:brand/:batch/:serial` | Aggregated verify result (chain plus indexer) | Public |
| `GET` | `/v1/units/:unitId` | Unit state and history timeline | Public |
| `POST` | `/v1/brands/batches` | Generate serials, secrets, Merkle tree; submit `commit_batch` | Brand |
| `GET` | `/v1/brands/batches/:id/export` | Download QR and secret export for printing | Brand |
| `POST` | `/v1/brands/recall` | Recall a batch or flag units | Brand |
| `POST` | `/v1/activate` | Relay `activate` with fee sponsorship | Public (rate limited) |
| `POST` | `/v1/transfer/offer` | Create transfer offer and code | Owner |
| `POST` | `/v1/transfer/redeem` | Redeem transfer code | Owner |
| `POST` | `/v1/claims` | File a warranty claim | Owner |
| `POST` | `/v1/claims/:id/resolve` | Resolve claim | Service center |
| `POST` | `/v1/files` | Upload receipt or service report; returns hash | Authenticated |
| `POST` | `/v1/sponsor` | Sign and submit a fee-bump transaction | Authenticated |

Rate limiting, abuse detection (per IP, per device, per unit) and request signing are required on all public write endpoints, because fee sponsorship can otherwise be drained.

## Indexer

Soroban RPC retains events for a limited window (days, not years), so Veritag runs its own indexer.

- Polls `getEvents` filtered by the registry contract ID.
- Stores a cursor so it can resume after restarts and handle ledger gaps.
- Decodes XDR into typed events and writes idempotently into Postgres.
- Handles chain reorganization edge cases by tracking ledger sequence and only marking events as final after confirmation.
- Can **backfill** from historical ledger archives if needed.

### Database schema (simplified)

```sql
brands(address PK, domain, verified, created_at)
batches(brand, batch_id, merkle_root, warranty_months, unit_count, recalled, created_at, PK(brand, batch_id))
units(unit_id PK, brand, batch_id, owner, status, activated_at, warranty_expiry, claims_used, scan_count)
unit_events(id PK, unit_id, type, data JSONB, ledger, tx_hash, created_at)
claims(unit_id, claim_id, service_center, outcome, report_hash, filed_at, resolved_at, PK(unit_id, claim_id))
files(hash PK, uploader, mime, size, storage_key, created_at)
scans(id PK, unit_id, ip_hash, ua_hash, created_at)
indexer_state(id PK, last_ledger, last_cursor)
```

## Frontend

Next.js (App Router) with TypeScript and Tailwind.

### Views

- **Verify (public, mobile first).** Scan result with a clear status banner, product info, warranty status, ownership history (anonymized), and the chain proof link.
- **Owner.** My products, warranty countdown, create transfer code, file claim, attach receipts.
- **Service center.** Incoming claims, resolve with outcome and report.
- **Brand dashboard.** Create batches, download print files, view activation analytics, geographic heatmap of scans, recall tooling.

### Notable UI behavior

- Verification reads directly from Soroban RPC where possible so users do not have to trust the backend.
- The page displays the contract ID and ledger so anyone can independently check.
- Offline-friendly QR scan page with graceful error states.

## Wallets and Fee Sponsorship

- **Consumers:** passkey smart wallets (WebAuthn, secp256r1) so users sign with Face ID or fingerprint, with no seed phrase and no XLM required.
- **Brands:** Freighter or another Stellar wallet, ideally a multisig account for batch commits and recalls.
- **Fees:** the backend wraps user transactions in fee-bump transactions paid from a sponsor account. Sponsor spending is capped per user, per IP and per unit.
- **Recovery:** passkey wallets support adding a second passkey or recovery signer.

## Privacy and Data Handling

- On-chain: only hashes, addresses, timestamps and status.
- Off-chain: invoices, receipts, service reports and personal details live in encrypted object storage, referenced by hash.
- Owner addresses are pseudonymous. The verify page shows ownership count and dates, not raw addresses, unless the owner chooses to share them.
- The design supports GDPR-style deletion of off-chain documents, because only their hashes remain on-chain.

## State Archival and TTL Strategy

Soroban persistent entries expire unless their TTL is extended, and archived entries must be restored before use.

- At `activate`, extend the unit entry TTL to cover the full warranty period plus a buffer.
- Service events (`file_claim`, `resolve_claim`, `redeem_transfer`) extend TTL again.
- A maintenance job (cron) bumps TTL for batches and high-value units close to expiry.
- The frontend and backend detect archived entries and prompt a restore operation (sponsored) before reading or writing.
- Batch records are extended at commit and bumped by the brand dashboard.

## Threat Model

| Threat | Mitigation |
|---|---|
| Counterfeiter copies a QR code | Hidden secret, burn on first claim, scan counter, NFC for premium goods |
| Fake brand registration | Registry admin approval plus `stellar.toml` domain proof |
| Brand tampers with history | History lives on-chain and is event-sourced; brands cannot edit past events |
| Stolen product resold | Owner can mark a unit as reported stolen (planned); transfer requires owner auth |
| Front-running of activation | Optional commit-reveal activation; secret bound to `first_owner` signature |
| Sponsor account drained | Rate limits, per-user caps, signed requests, monitoring |
| Malicious service center | Brand-controlled allowlist of service centers per brand |
| Lost owner key | Passkey recovery signer and brand-assisted recovery policy (planned) |
| Brand key compromise | Multisig brand accounts, key rotation entrypoint |
| Merkle tree leak (secrets exposed before shipping) | Secrets are generated and exported once, encrypted at rest, deleted after printing |
| Archived state breaks verification | TTL maintenance job and restore flow |

See [`docs/threat-model.md`](docs/threat-model.md) for the extended analysis.

## Getting Started

### Prerequisites

- Rust (stable) with the `wasm32v1-none` target (or `wasm32-unknown-unknown` for older toolchains)
- [Stellar CLI](https://developers.stellar.org/docs/tools/cli)
- Node.js 20+ and pnpm
- Docker and Docker Compose (for Postgres)
- A Stellar testnet account (funded via Friendbot)

### 1. Clone and install

```bash
git clone https://github.com/<your-username>/veritag.git
cd veritag
pnpm install
```

### 2. Build and test the contract

```bash
cd contracts/registry
cargo test
stellar contract build
```

### 3. Create and fund a testnet identity

```bash
stellar keys generate deployer --network testnet --fund
stellar keys address deployer
```

### 4. Deploy to testnet

```bash
./scripts/deploy-testnet.sh
# prints the CONTRACT_ID, which you copy into .env
```

### 5. Configure environment

```bash
cp .env.example .env
# edit values (see Configuration below)
```

### 6. Start services

```bash
docker compose up -d postgres
pnpm --filter backend db:migrate
pnpm --filter backend dev
pnpm --filter indexer dev
pnpm --filter web dev
```

Open http://localhost:3000.

### 7. Seed demo data

```bash
pnpm tsx scripts/seed-demo.ts
```

This registers a demo brand, commits a batch of 1,000 units, and prints sample QR URLs you can open on the verify page.

## Configuration

`.env.example`:

```bash
# Network
STELLAR_NETWORK=testnet
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
HORIZON_URL=https://horizon-testnet.stellar.org
NETWORK_PASSPHRASE="Test SDF Network ; September 2015"

# Contract
REGISTRY_CONTRACT_ID=C...

# Accounts
REGISTRY_ADMIN_SECRET=S...        # admin key used to verify brands (testnet only!)
SPONSOR_SECRET=S...               # fee sponsor account

# Backend
DATABASE_URL=postgres://veritag:veritag@localhost:5432/veritag
BACKEND_PORT=4000
JWT_SECRET=change-me
RATE_LIMIT_PER_MIN=30

# Storage (S3 compatible)
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=veritag-files
S3_ACCESS_KEY=...
S3_SECRET_KEY=...

# Web
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_REGISTRY_CONTRACT_ID=C...
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
```

> Never commit real secret keys. Use a secrets manager in production and hardware-backed or multisig keys for any mainnet account.

## Deployment

**Testnet:** use `scripts/deploy-testnet.sh` and Docker Compose for the services.

**Mainnet checklist:**

- [ ] Independent smart contract audit completed
- [ ] Registry admin is a multisig or governance contract
- [ ] Sponsor account has strict spending caps and monitoring
- [ ] Indexer runs with redundancy and automated backups
- [ ] TTL maintenance job deployed and alerting
- [ ] Rate limiting and abuse detection tuned
- [ ] Legal review (data protection, pharma regulations, consumer law) per target market
- [ ] Incident response and recall runbook documented

## Testing

### Contract

```bash
cd contracts/registry
cargo test
```

Test coverage should include:

- Brand registration and verification flow
- Batch commit, duplicate batch rejection
- Merkle proof: valid, invalid, wrong secret, wrong serial
- Activation: success, double activation, recalled batch
- Transfer offers: valid code, wrong code, expired offer, cancellation
- Warranty: valid, expired, boundary conditions
- Claims: limits, unauthorized service center, resolution
- Flag and recall behavior across all entrypoints
- TTL extension behavior
- Authorization checks on every mutating function

### Backend and indexer

```bash
pnpm --filter backend test
pnpm --filter indexer test
```

Integration tests run against a local Stellar quickstart container.

### End to end

```bash
pnpm --filter web test:e2e
```

Playwright flows: verify page states, activation, transfer, claim.

## Roadmap

- [ ] **Phase 1: Contract MVP.** Brand registration, direct mint, transfer, warranty check, unit tests.
- [ ] **Phase 2: Verify page.** QR scan, `get_unit`, authentic / claimed / recalled states.
- [ ] **Phase 3: Merkle batches.** Lazy activation, scratch-secret flow.
- [ ] **Phase 4: Indexer.** Ownership history timeline and scan analytics.
- [ ] **Phase 5: Claims.** Service-center roles and claim workflow.
- [ ] **Phase 6: Onboarding.** Passkey wallets and fee sponsorship.
- [ ] **Phase 7: Brand dashboard.** Batch tooling, recall management, analytics.
- [ ] **Phase 8: Hardware.** NFC signed-counter tag support.
- [ ] **Phase 9: Pharma extensions.** Lot and expiry tracking, supply-chain custody events, regulator read access.
- [ ] **Phase 10: Marketplaces.** Embeddable verification widget and API for resale platforms.

## Contributing

Contributions are welcome. Please:

1. Open an issue to discuss significant changes first.
2. Fork the repo and create a feature branch.
3. Add tests for any contract or API change.
4. Run `cargo fmt`, `cargo clippy`, and `pnpm lint` before submitting.
5. Open a pull request with a clear description.

Security issues should be reported privately; do not open public issues for vulnerabilities.

## License

MIT (see [LICENSE](LICENSE)). 

---

*Veritag: know what you're buying, and prove what you own.*
