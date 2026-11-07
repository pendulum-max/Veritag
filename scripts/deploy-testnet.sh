#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

IDENTITY="${STELLAR_IDENTITY:-deployer}"
NETWORK="${STELLAR_NETWORK:-testnet}"
ALIAS="${CONTRACT_ALIAS:-veritag-registry}"

echo "==> Building Veritag registry contract WASM..."
stellar contract build --package registry

WASM_PATH="$ROOT_DIR/target/wasm32v1-none/release/registry.wasm"
if [[ ! -f "$WASM_PATH" ]]; then
  echo "Error: WASM artifact not found at $WASM_PATH" >&2
  exit 1
fi

echo "==> Ensuring Stellar identity '$IDENTITY' exists on $NETWORK..."
if ! stellar keys address "$IDENTITY" >/dev/null 2>&1; then
  stellar keys generate "$IDENTITY" --network "$NETWORK" --fund
fi

ADMIN_ADDRESS="$(stellar keys address "$IDENTITY")"
echo "==> Admin address: $ADMIN_ADDRESS"

echo "==> Deploying contract to $NETWORK..."
CONTRACT_ID="$(stellar contract deploy \
  --wasm "$WASM_PATH" \
  --source-account "$IDENTITY" \
  --network "$NETWORK" \
  --alias "$ALIAS")"

echo "==> Initializing contract with admin $ADMIN_ADDRESS..."
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source-account "$IDENTITY" \
  --network "$NETWORK" \
  -- \
  init \
  --admin "$ADMIN_ADDRESS"

echo ""
echo "============================================================"
echo "Veritag Registry deployed and initialized on $NETWORK!"
echo "REGISTRY_CONTRACT_ID=$CONTRACT_ID"
echo "ADMIN_ADDRESS=$ADMIN_ADDRESS"
echo "============================================================"
