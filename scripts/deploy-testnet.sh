#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

IDENTITY="${STELLAR_IDENTITY:-deployer}"
NETWORK="${STELLAR_NETWORK:-testnet}"
REGISTRY_ALIAS="${CONTRACT_ALIAS:-veritag-registry}"
FACTORY_ALIAS="${FACTORY_ALIAS:-veritag-account-factory}"

echo "==> Building all Veritag Soroban contracts..."
stellar contract build

REGISTRY_WASM="$ROOT_DIR/target/wasm32v1-none/release/registry.wasm"
PASSKEY_WASM="$ROOT_DIR/target/wasm32v1-none/release/passkey_account.wasm"
FACTORY_WASM="$ROOT_DIR/target/wasm32v1-none/release/account_factory.wasm"

for f in "$REGISTRY_WASM" "$PASSKEY_WASM" "$FACTORY_WASM"; do
  if [[ ! -f "$f" ]]; then
    echo "Error: WASM artifact not found at $f" >&2
    exit 1
  fi
done

echo "==> Ensuring Stellar identity '$IDENTITY' exists on $NETWORK..."
if ! stellar keys address "$IDENTITY" >/dev/null 2>&1; then
  stellar keys generate "$IDENTITY" --network "$NETWORK" --fund
fi

ADMIN_ADDRESS="$(stellar keys address "$IDENTITY")"
echo "==> Admin address: $ADMIN_ADDRESS"

echo "==> Deploying Veritag Registry contract to $NETWORK..."
REGISTRY_ID="$(stellar contract deploy \
  --wasm "$REGISTRY_WASM" \
  --source-account "$IDENTITY" \
  --network "$NETWORK" \
  --alias "$REGISTRY_ALIAS")"

echo "==> Initializing Registry contract with admin $ADMIN_ADDRESS..."
stellar contract invoke \
  --id "$REGISTRY_ID" \
  --source-account "$IDENTITY" \
  --network "$NETWORK" \
  -- \
  init \
  --admin "$ADMIN_ADDRESS"

echo "==> Uploading PasskeyAccount WASM to $NETWORK..."
PASSKEY_WASM_HASH="$(stellar contract upload \
  --wasm "$PASSKEY_WASM" \
  --source-account "$IDENTITY" \
  --network "$NETWORK")"

echo "==> Deploying AccountFactory contract to $NETWORK..."
FACTORY_ID="$(stellar contract deploy \
  --wasm "$FACTORY_WASM" \
  --source-account "$IDENTITY" \
  --network "$NETWORK" \
  --alias "$FACTORY_ALIAS" \
  -- \
  --account_wasm_hash "$PASSKEY_WASM_HASH")"

echo ""
echo "============================================================"
echo "Veritag Contracts deployed and initialized on $NETWORK!"
echo "REGISTRY_CONTRACT_ID=$REGISTRY_ID"
echo "ACCOUNT_FACTORY_CONTRACT_ID=$FACTORY_ID"
echo "PASSKEY_ACCOUNT_WASM_HASH=$PASSKEY_WASM_HASH"
echo "ADMIN_ADDRESS=$ADMIN_ADDRESS"
echo "============================================================"
