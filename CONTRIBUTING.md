# Contributing to Veritag

Thank you for your interest in contributing to **Veritag** — the open-source physical product authenticity, digital warranty, and circular-economy provenance registry built on **Stellar Soroban**!

We welcome contributors of all experience levels, including participants in the **Drips Stellar Wave Program**.

---

## Table of Contents

1. [Repository Overview](#repository-overview)
2. [Prerequisites](#prerequisites)
3. [Quick Local Setup](#quick-local-setup)
4. [Running Tests & Linting](#running-tests--linting)
5. [Working with Soroban Smart Contracts](#working-with-soroban-smart-contracts)
6. [Database Migrations & Docker Setup](#database-migrations--docker-setup)
7. [Drips Wave & Pull Request Guidelines](#drips-wave--pull-request-guidelines)

---

## Repository Overview

| Directory | Stack | Purpose |
| :--- | :--- | :--- |
| `contracts/veritag-registry` | Rust (`soroban-sdk` 22) | Core authenticity, Merkle batch commit, lazy activation, resale transfer, warranty claims, and recall registry contract. |
| `contracts/passkey-account` | Rust (`soroban-sdk` 22) | Custom Soroban smart account (`__check_auth`) verifying WebAuthn `secp256r1` (P-256) passkey signatures on-chain. |
| `contracts/account-factory` | Rust (`soroban-sdk` 22) | Deterministic smart wallet factory (`deploy_v2`) for passkey accounts. |
| `packages/sdk` | TypeScript (`@stellar/stellar-sdk`) | Generated contract bindings, SHA-256 Merkle proofs, WebAuthn P-256 key/signature normalizers, and ISO/IEC 18004 QR SVG generator. |
| `backend` | TypeScript (Hono, `pg`, Zod) | REST API, SEP-10/Passkey auth, `stellar.toml` domain verifier, fee-bump transaction sponsor relayer, and TTL archival worker. |
| `indexer` | TypeScript | Soroban RPC `getEvents` polling & ledger-range backfill worker with cursor-based reorg recovery. |
| `web` | Next.js 15 / React 19 / Tailwind CSS | Public QR scan & verification portal, Brand Portal, Consumer Owner Portal, and Authorized Service Center Portal. |

---

## Prerequisites

- **Node.js** `>= 20.x` and **pnpm** `>= 9.x`
- **Rust** stable toolchain (`rustup`) with the `wasm32v1-none` target:
  ```bash
  rustup target add wasm32v1-none
  ```
- **Stellar CLI** (`stellar-cli` >= 22.x) for contract deployment and TypeScript binding generation:
  ```bash
  cargo install --locked stellar-cli --features opt
  ```
- *(Optional)* **Docker & Docker Compose** for running local PostgreSQL 16 and MinIO S3-compatible storage.

---

## Quick Local Setup

1. **Clone the repository and install workspace dependencies:**
   ```bash
   git clone https://github.com/pendulum-max/Veritag.git
   cd Veritag
   pnpm install
   ```

2. **Copy the environment configuration:**
   ```bash
   cp .env.example .env
   ```
   By default, `.env.example` is pre-configured with our live **Stellar Testnet** contract IDs and uses zero-config local JSON/in-memory persistence so you can start developing immediately without running external services.

3. **Build all packages and start the development servers:**
   ```bash
   pnpm build
   pnpm dev
   ```
   - Backend API: `http://localhost:4000`
   - Next.js Web App: `http://localhost:3000`

4. **(Optional) Seed demo data:**
   ```bash
   npx tsx scripts/seed-demo.ts
   ```

---

## Running Tests & Linting

Before opening a Pull Request, verify that all Rust and TypeScript checks pass:

```bash
# 1. Run Soroban smart contract unit tests & Clippy
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings

# 2. Run TypeScript SDK, Backend, Indexer, E2E, and Web tests
pnpm test

# 3. Run strict TypeScript typechecking across all workspaces
pnpm lint
```

---

## Working with Soroban Smart Contracts

If you modify any contract signatures in `contracts/veritag-registry`, `contracts/passkey-account`, or `contracts/account-factory`:

1. Compile the contracts to WASM and regenerate the TypeScript SDK bindings:
   ```bash
   bash scripts/generate-bindings.sh
   ```
2. Rebuild `@veritag/sdk` so downstream packages (`backend`, `indexer`, `web`) pick up the updated types:
   ```bash
   pnpm --filter @veritag/sdk build
   ```

---

## Database Migrations & Docker Setup

To test against a real PostgreSQL 16 database and MinIO S3 object store:

```bash
# Start PostgreSQL and MinIO in the background
docker compose up -d postgres minio

# Apply SQL migrations to PostgreSQL
pnpm db:migrate
```

---

## Drips Wave & Pull Request Guidelines

1. **One Issue per PR:** Reference the issue you are solving in your PR description (e.g., `Closes #42`).
2. **Scoped & Atomic Commits:** Use Conventional Commits (`feat(contracts): ...`, `fix(backend): ...`, `test(sdk): ...`, `docs: ...`).
3. **Include Tests:** Any new contract method, SDK utility, or backend endpoint must include corresponding unit or integration tests.
4. **Preserve Documentation:** Keep `docs/architecture.md` and `docs/api.md` in sync if you introduce new endpoints or contract events.
