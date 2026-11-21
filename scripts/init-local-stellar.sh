#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# init-local-stellar.sh
#
# Initialises a local Stellar Quickstart (standalone/Soroban-dev) node:
#   1. Waits for the Quickstart node to be ready.
#   2. Funds the REGISTRY_ADMIN and SPONSOR accounts via the local Friendbot.
#   3. Builds all three Soroban contracts (registry, passkey-account,
#      account-factory).
#   4. Deploys and initialises all contracts against the local network.
#   5. Writes the resulting IDs/hashes to .env.local so you can source it
#      or copy values into your .env.
#
# Prerequisites
#   - Docker Compose local stack is running:
#       docker compose -f docker-compose.local.yml up -d
#   - stellar-cli >= 22 is installed and on PATH.
#   - cargo / Rust wasm32v1-none target available (for contract build step).
#
# Usage
#   ./scripts/init-local-stellar.sh
#
# Options (via environment variables)
#   QUICKSTART_HOST     Hostname of the Quickstart container  (default: localhost)
#   QUICKSTART_PORT     Horizon port                           (default: 8000)
#   SOROBAN_PORT        Soroban RPC port                       (default: 8001)
#   ADMIN_IDENTITY      stellar-cli key name for admin account (default: veritag-local-admin)
#   SPONSOR_IDENTITY    stellar-cli key name for sponsor       (default: veritag-local-sponsor)
#   SKIP_BUILD          Set to "1" to skip cargo build         (default: unset)
#   ENV_OUT             Path where .env.local is written       (default: .env.local in repo root)
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
QS_HOST="${QUICKSTART_HOST:-localhost}"
QS_PORT="${QUICKSTART_PORT:-8000}"
SOROBAN_PORT="${SOROBAN_PORT:-8001}"
FRIENDBOT_PORT="${FRIENDBOT_PORT:-8002}"

HORIZON_URL="http://${QS_HOST}:${QS_PORT}"
SOROBAN_RPC_URL="http://${QS_HOST}:${SOROBAN_PORT}"
FRIENDBOT_URL="http://${QS_HOST}:${QS_PORT}/friendbot"
NETWORK_PASSPHRASE="Standalone Network ; February 2017"
LOCAL_NETWORK_NAME="local-standalone"

ADMIN_IDENTITY="${ADMIN_IDENTITY:-veritag-local-admin}"
SPONSOR_IDENTITY="${SPONSOR_IDENTITY:-veritag-local-sponsor}"

SKIP_BUILD="${SKIP_BUILD:-}"
ENV_OUT="${ENV_OUT:-$ROOT_DIR/.env.local}"

REGISTRY_WASM="$ROOT_DIR/target/wasm32v1-none/release/registry.wasm"
PASSKEY_WASM="$ROOT_DIR/target/wasm32v1-none/release/passkey_account.wasm"
FACTORY_WASM="$ROOT_DIR/target/wasm32v1-none/release/account_factory.wasm"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
info()  { echo "  [INFO]  $*"; }
step()  { echo ""; echo "==> $*"; }
die()   { echo "  [ERROR] $*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "'$1' is required but not found on PATH."
}

# ---------------------------------------------------------------------------
# Dependency checks
# ---------------------------------------------------------------------------
require_cmd stellar
require_cmd curl
require_cmd jq

# ---------------------------------------------------------------------------
# Step 1: Wait for Quickstart / Horizon to be reachable
# ---------------------------------------------------------------------------
step "Waiting for Stellar Quickstart to become ready at $HORIZON_URL ..."
MAX_WAIT=120   # seconds
ELAPSED=0
until curl -sf "${HORIZON_URL}/" | grep -q '"network_passphrase"' 2>/dev/null; do
  if [[ $ELAPSED -ge $MAX_WAIT ]]; then
    die "Quickstart did not become ready within ${MAX_WAIT}s. Is the Docker stack running?\n  docker compose -f docker-compose.local.yml up -d"
  fi
  printf "."
  sleep 2
  ELAPSED=$((ELAPSED + 2))
done
echo ""
info "Quickstart is ready."

# ---------------------------------------------------------------------------
# Step 2: Register the local network with stellar-cli (idempotent)
# ---------------------------------------------------------------------------
step "Registering local network '$LOCAL_NETWORK_NAME' with stellar-cli..."
# Remove stale entry silently, then re-add.
stellar network rm "$LOCAL_NETWORK_NAME" 2>/dev/null || true
stellar network add "$LOCAL_NETWORK_NAME" \
  --rpc-url "$SOROBAN_RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE"
info "Network '$LOCAL_NETWORK_NAME' registered."

# ---------------------------------------------------------------------------
# Step 3: Create / fund ADMIN and SPONSOR keypairs
# ---------------------------------------------------------------------------
fund_account() {
  local identity="$1"
  local address

  if ! stellar keys address "$identity" >/dev/null 2>&1; then
    info "Generating new keypair for '$identity'..."
    stellar keys generate "$identity" --no-fund
  fi

  address="$(stellar keys address "$identity")"
  info "Funding $identity ($address) via Friendbot..."
  curl -sf "${FRIENDBOT_URL}?addr=${address}" | jq -r '.hash' \
    || die "Friendbot funding failed for $identity ($address)."
  info "Funded: $address"
  echo "$address"
}

step "Creating / funding ADMIN identity: $ADMIN_IDENTITY"
ADMIN_ADDRESS="$(fund_account "$ADMIN_IDENTITY")"

step "Creating / funding SPONSOR identity: $SPONSOR_IDENTITY"
SPONSOR_ADDRESS="$(fund_account "$SPONSOR_IDENTITY")"

# Export secrets for later use in .env.local
ADMIN_SECRET="$(stellar keys secret "$ADMIN_IDENTITY" 2>/dev/null || echo "")"
SPONSOR_SECRET_KEY="$(stellar keys secret "$SPONSOR_IDENTITY" 2>/dev/null || echo "")"

# ---------------------------------------------------------------------------
# Step 4: Build Soroban contracts (unless SKIP_BUILD=1)
# ---------------------------------------------------------------------------
if [[ -z "$SKIP_BUILD" ]]; then
  step "Building all Veritag Soroban contracts..."
  stellar contract build
else
  step "Skipping contract build (SKIP_BUILD=1)."
fi

# Verify WASM artifacts exist
for f in "$REGISTRY_WASM" "$PASSKEY_WASM" "$FACTORY_WASM"; do
  [[ -f "$f" ]] || die "WASM artifact not found: $f\nRun: stellar contract build"
done
info "All WASM artifacts present."

# ---------------------------------------------------------------------------
# Step 5: Deploy the Registry contract
# ---------------------------------------------------------------------------
step "Deploying VeritagRegistry contract to '$LOCAL_NETWORK_NAME'..."
REGISTRY_ID="$(stellar contract deploy \
  --wasm "$REGISTRY_WASM" \
  --source-account "$ADMIN_IDENTITY" \
  --network "$LOCAL_NETWORK_NAME")"
info "Registry contract ID: $REGISTRY_ID"

step "Initialising Registry contract (admin = $ADMIN_ADDRESS)..."
stellar contract invoke \
  --id "$REGISTRY_ID" \
  --source-account "$ADMIN_IDENTITY" \
  --network "$LOCAL_NETWORK_NAME" \
  -- \
  init \
  --admin "$ADMIN_ADDRESS"
info "Registry initialised."

# ---------------------------------------------------------------------------
# Step 6: Upload PasskeyAccount WASM
# ---------------------------------------------------------------------------
step "Uploading PasskeyAccount WASM to '$LOCAL_NETWORK_NAME'..."
PASSKEY_WASM_HASH="$(stellar contract upload \
  --wasm "$PASSKEY_WASM" \
  --source-account "$ADMIN_IDENTITY" \
  --network "$LOCAL_NETWORK_NAME")"
info "PasskeyAccount WASM hash: $PASSKEY_WASM_HASH"

# ---------------------------------------------------------------------------
# Step 7: Deploy the AccountFactory contract
# ---------------------------------------------------------------------------
step "Deploying AccountFactory contract to '$LOCAL_NETWORK_NAME'..."
FACTORY_ID="$(stellar contract deploy \
  --wasm "$FACTORY_WASM" \
  --source-account "$ADMIN_IDENTITY" \
  --network "$LOCAL_NETWORK_NAME" \
  -- \
  --account_wasm_hash "$PASSKEY_WASM_HASH")"
info "AccountFactory contract ID: $FACTORY_ID"

# ---------------------------------------------------------------------------
# Step 8: Write .env.local
# ---------------------------------------------------------------------------
step "Writing local environment file to $ENV_OUT ..."
cat > "$ENV_OUT" <<EOF
# Auto-generated by scripts/init-local-stellar.sh
# Source this file or copy values into your .env before starting the backend.
#   source .env.local

# ---- Local Stellar Network ------------------------------------------------
STELLAR_NETWORK=standalone
SOROBAN_RPC_URL=${SOROBAN_RPC_URL}
HORIZON_URL=${HORIZON_URL}
NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE}"

# ---- Deployed Contracts ---------------------------------------------------
REGISTRY_CONTRACT_ID=${REGISTRY_ID}
ACCOUNT_FACTORY_CONTRACT_ID=${FACTORY_ID}
PASSKEY_ACCOUNT_WASM_HASH=${PASSKEY_WASM_HASH}

# ---- Funded Accounts ------------------------------------------------------
REGISTRY_ADMIN_SECRET=${ADMIN_SECRET}
SPONSOR_SECRET=${SPONSOR_SECRET_KEY}

# ---- Backend & Services (unchanged from .env.example) --------------------
DATABASE_URL=postgres://veritag:veritag@localhost:5432/veritag
BACKEND_PORT=4000
JWT_SECRET=local-dev-secret
RATE_LIMIT_PER_MIN=120
LOCAL_STORAGE_DIR=.data/storage

INDEXER_POLL_INTERVAL_MS=2000
INDEXER_CONFIRMATION_LEDGERS=1

S3_ENDPOINT=http://localhost:9000
S3_BUCKET=veritag-files
S3_ACCESS_KEY=veritag
S3_SECRET_KEY=veritag-secret

NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_REGISTRY_CONTRACT_ID=${REGISTRY_ID}
NEXT_PUBLIC_ACCOUNT_FACTORY_CONTRACT_ID=${FACTORY_ID}
NEXT_PUBLIC_SOROBAN_RPC_URL=${SOROBAN_RPC_URL}
NEXT_PUBLIC_NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE}"
EOF

info ".env.local written."

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo "============================================================"
echo " Veritag local Stellar network ready!"
echo ""
echo "  Horizon RPC:              $HORIZON_URL"
echo "  Soroban RPC:              $SOROBAN_RPC_URL"
echo "  Passphrase:               $NETWORK_PASSPHRASE"
echo ""
echo "  Registry contract:        $REGISTRY_ID"
echo "  AccountFactory contract:  $FACTORY_ID"
echo "  PasskeyAccount WASM hash: $PASSKEY_WASM_HASH"
echo ""
echo "  Admin account:            $ADMIN_ADDRESS"
echo "  Sponsor account:          $SPONSOR_ADDRESS"
echo ""
echo "  Environment file:         $ENV_OUT"
echo ""
echo "Next steps:"
echo "  source $ENV_OUT"
echo "  pnpm --filter backend db:migrate"
echo "  pnpm --filter backend dev"
echo "============================================================"
