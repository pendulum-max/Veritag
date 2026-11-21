# Veritag Contributor Guide

This guide walks through every step needed to get Veritag running on your machine, from installing prerequisites to running all tests. It covers macOS (Homebrew), Ubuntu/Debian, and Windows (WSL2), and ends with a troubleshooting runbook for the top-10 setup issues contributors encounter.

---

## Table of Contents

1. [Repository overview](#repository-overview)
2. [Prerequisites by OS](#prerequisites-by-os)
   - [macOS (Homebrew)](#macos-homebrew)
   - [Ubuntu / Debian](#ubuntu--debian)
   - [Windows (WSL2)](#windows-wsl2)
3. [Clone and install](#clone-and-install)
4. [Configure environment](#configure-environment)
5. [Start infrastructure](#start-infrastructure)
6. [Run the services](#run-the-services)
7. [Build and test the smart contracts](#build-and-test-the-smart-contracts)
8. [Running all tests](#running-all-tests)
9. [Troubleshooting runbook](#troubleshooting-runbook)

---

## Repository overview

```
veritag/
├── contracts/
│   ├── registry/           Rust — core authenticity, Merkle, claims, recalls
│   ├── passkey-account/    Rust — WebAuthn secp256r1 smart account
│   └── account-factory/    Rust — deterministic smart wallet factory
├── packages/sdk/           TypeScript — generated bindings + Merkle + QR helpers
├── backend/                TypeScript — Hono REST API, relayer, auth, storage
├── indexer/                TypeScript — Soroban RPC event poller → Postgres
├── web/                    Next.js 15 — verify portal, brand & owner dashboards
├── scripts/
│   ├── deploy-testnet.sh   Deploy all contracts to Stellar Testnet
│   ├── init-local-stellar.sh  Bootstrap the local standalone network
│   └── load-test.js        k6 load & stress test
├── docs/
│   ├── architecture.md
│   ├── api.md
│   ├── threat-model.md
│   ├── load-testing.md
│   └── contributor-guide.md   ← you are here
├── docker-compose.yml      Testnet/cloud services
└── docker-compose.local.yml   Standalone local Stellar stack
```

---

## Prerequisites by OS

### macOS (Homebrew)

```bash
# 1. Homebrew (if not installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 2. Node.js 20 LTS
brew install node@20
echo 'export PATH="/opt/homebrew/opt/node@20/bin:$PATH"' >> ~/.zprofile
source ~/.zprofile

# 3. pnpm (Node package manager used by this monorepo)
npm install -g pnpm@latest

# 4. Rust stable + wasm32v1-none target
brew install rustup
rustup-init -y
source "$HOME/.cargo/env"
rustup target add wasm32v1-none

# 5. Stellar CLI (requires Cargo — installed above)
cargo install --locked stellar-cli --features opt

# 6. Docker Desktop
brew install --cask docker
# Open Docker Desktop from Applications once after install.

# 7. Verify versions
node  --version          # >= 20
pnpm  --version          # >= 9
rustc --version          # >= 1.76 (stable)
stellar --version        # >= 22
docker --version
docker compose version
```

### Ubuntu / Debian

```bash
# 1. Node.js 20 LTS (NodeSource PPA)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. pnpm
npm install -g pnpm@latest

# 3. Build essentials (required by some native modules)
sudo apt-get install -y build-essential curl git

# 4. Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
rustup target add wasm32v1-none

# 5. Stellar CLI
cargo install --locked stellar-cli --features opt

# 6. Docker Engine + Compose plugin
sudo apt-get install -y ca-certificates gnupg lsb-release
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Allow running Docker without sudo
sudo usermod -aG docker "$USER"
newgrp docker

# 7. Verify versions
node  --version
pnpm  --version
rustc --version
stellar --version
docker compose version
```

### Windows (WSL2)

All development happens inside a WSL2 Ubuntu distribution. Docker Desktop for Windows handles container management.

```powershell
# PowerShell (run as Administrator)
wsl --install -d Ubuntu-22.04
# Restart when prompted, then open the Ubuntu terminal.
```

Inside the WSL2 Ubuntu terminal, follow the **Ubuntu / Debian** instructions above, then additionally:

```bash
# Point Docker commands at Docker Desktop for Windows
# Docker Desktop must be running and have WSL2 integration enabled in
# Settings → Resources → WSL Integration → "Ubuntu-22.04".

# Verify Docker is accessible from WSL2
docker info
docker compose version
```

> **Note:** Do NOT install a separate Docker Engine inside WSL2 when using Docker Desktop — the two will conflict. Use Docker Desktop's WSL2 backend exclusively.

---

## Clone and install

```bash
git clone https://github.com/pendulum-max/Veritag.git
cd Veritag
pnpm install
```

`pnpm install` installs all workspace packages (`backend`, `indexer`, `web`, `packages/sdk`) in one pass. It respects the workspace dependency graph, so `@veritag/sdk` is built before packages that depend on it.

---

## Configure environment

```bash
cp .env.example .env
```

The defaults in `.env.example` target the public **Stellar Testnet** and require no changes to get started. For offline or airplane development, see [local standalone setup](#local-standalone-setup-offline) below.

Key variables:

| Variable | Default | Description |
|---|---|---|
| `SOROBAN_RPC_URL` | `https://soroban-testnet.stellar.org` | Soroban RPC endpoint |
| `HORIZON_URL` | `https://horizon-testnet.stellar.org` | Horizon REST API |
| `REGISTRY_CONTRACT_ID` | pre-deployed testnet address | Registry contract ID |
| `REGISTRY_ADMIN_SECRET` | (placeholder) | Testnet admin keypair — replace with your own |
| `SPONSOR_SECRET` | (placeholder) | Fee-sponsor keypair |
| `DATABASE_URL` | `postgres://veritag:veritag@localhost:5432/veritag` | PostgreSQL connection |
| `JWT_SECRET` | `change-me-in-production` | HS256 signing secret |

---

## Start infrastructure

```bash
# Start PostgreSQL and MinIO (S3-compatible storage)
docker compose up -d postgres minio

# Apply database migrations
pnpm --filter @veritag/backend db:migrate
```

### Local standalone setup (offline)

If you cannot reach the public Stellar Testnet:

```bash
# Start the full local stack (includes Stellar Quickstart + Postgres + MinIO)
docker compose -f docker-compose.local.yml up -d

# Wait ~15 s, then fund accounts and deploy contracts
./scripts/init-local-stellar.sh

# Source the generated environment
source .env.local

# Apply migrations
pnpm --filter @veritag/backend db:migrate
```

---

## Run the services

```bash
# Backend API (http://localhost:4000)
pnpm --filter @veritag/backend dev

# Indexer (polls Soroban RPC → Postgres)
pnpm --filter @veritag/indexer dev

# Web app (http://localhost:3000)
pnpm --filter web dev
```

Or start everything with the `full` Docker profile:

```bash
docker compose -f docker-compose.local.yml --profile full up -d
```

Swagger UI is available at http://localhost:4000/docs once the backend is running.

---

## Build and test the smart contracts

```bash
# Build all three contracts to WASM
stellar contract build

# Run all contract unit tests
cargo test --workspace

# Lint
cargo clippy --workspace --all-targets -- -D warnings
```

If you change a contract's public interface, regenerate the TypeScript SDK bindings:

```bash
./scripts/generate-bindings.sh
pnpm --filter @veritag/sdk build
```

---

## Running all tests

```bash
# TypeScript (all workspaces)
pnpm test

# TypeScript type-check
pnpm typecheck

# Rust contracts
cargo test --workspace

# k6 load test (requires k6 installed — see docs/load-testing.md)
pnpm test:load
```

---

## Troubleshooting runbook

### 1. `error[E0463]: can't find crate for 'std'` (Rust contract build fails)

**Cause:** The `wasm32v1-none` target is not installed.

```bash
rustup target add wasm32v1-none
# If your toolchain is older and doesn't recognise wasm32v1-none, try:
rustup target add wasm32-unknown-unknown
```

---

### 2. `stellar: command not found` after `cargo install`

**Cause:** Cargo's bin directory is not on `PATH`.

```bash
source "$HOME/.cargo/env"
# Add permanently to your shell profile:
echo 'source "$HOME/.cargo/env"' >> ~/.bashrc   # or ~/.zshrc
```

---

### 3. `soroban-sdk` version mismatch (`use of unstable library feature`)

**Cause:** The installed Stellar CLI version and the `soroban-sdk` version in `Cargo.toml` are out of sync.  Stellar CLI and `soroban-sdk` must use the same protocol version.

```bash
# Check versions
stellar --version
grep soroban-sdk contracts/registry/Cargo.toml

# Upgrade Stellar CLI to match the SDK version in Cargo.toml
cargo install --locked stellar-cli --features opt --version <version>
```

---

### 4. `pnpm: command not found` or workspace install fails

**Cause:** pnpm is not installed, or the installed version is older than 9.

```bash
npm install -g pnpm@latest
# Or via corepack (Node 20+):
corepack enable
corepack prepare pnpm@latest --activate
```

If `pnpm install` fails with dependency resolution errors, clear the cache:

```bash
pnpm store prune
pnpm install
```

---

### 5. `pnpm build` fails because `@veritag/sdk` isn't built yet

**Cause:** `backend` and `indexer` import `@veritag/sdk`, which must be compiled before them.

```bash
pnpm --filter @veritag/sdk build
pnpm build
```

The correct build order is enforced by the workspace dependency graph, but running individual package builds out of order bypasses it.

---

### 6. PostgreSQL connection refused (`ECONNREFUSED 127.0.0.1:5432`)

**Cause:** The Postgres container is not running or is still starting.

```bash
# Check container status
docker compose ps

# Start or restart Postgres
docker compose up -d postgres

# Confirm it is healthy
docker compose exec postgres pg_isready -U veritag
```

If using a local Postgres installation (not Docker), verify that it's running and that `DATABASE_URL` matches its host/port/credentials.

---

### 7. Docker permission denied (`Got permission denied while trying to connect to the Docker daemon`)

**Cause (Linux):** Your user is not in the `docker` group.

```bash
sudo usermod -aG docker "$USER"
newgrp docker
# Or log out and back in.
```

---

### 8. `Error: Soroban RPC request failed` or `fetch failed` from the backend

**Cause:** `SOROBAN_RPC_URL` in `.env` points to an unreachable endpoint.

- **Testnet:** confirm you have internet access and the Stellar Testnet is not under maintenance at [status.stellar.org](https://status.stellar.org).
- **Local:** confirm `docker compose -f docker-compose.local.yml ps` shows `stellar-quickstart` as `healthy`, and that `SOROBAN_RPC_URL=http://localhost:8001` in `.env.local`.

---

### 9. `Error: InvalidProof` on activation

**Cause:** The Merkle proof in the activate request does not match the batch's Merkle root stored in the database.

This often happens after re-creating the batch (new Merkle root) without updating the QR data. Re-export the batch:

```bash
GET /v1/brands/batches/<batchId>/export
```

and use the `proof` array from the export.

---

### 10. `MinIO: Access Denied` when uploading files

**Cause:** The `S3_ACCESS_KEY` / `S3_SECRET_KEY` in `.env` don't match the MinIO container's credentials.

The defaults are `veritag` / `veritag-secret` — confirm your `.env` matches and that MinIO is running:

```bash
docker compose ps minio
# Reset MinIO credentials by recreating the container:
docker compose rm -sf minio
docker compose up -d minio
```

---

## Getting help

- Open an issue at [github.com/pendulum-max/Veritag/issues](https://github.com/pendulum-max/Veritag/issues).
- For Drips Stellar Wave contributor questions, reference your wave task number in the issue title.
- See [CONTRIBUTING.md](../CONTRIBUTING.md) for PR guidelines and commit conventions.
