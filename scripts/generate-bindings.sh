#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BINDINGS_TMP="$ROOT_DIR/packages/sdk/generated-tmp"
GENERATED_DIR="$ROOT_DIR/packages/sdk/src/generated"
mkdir -p "$GENERATED_DIR"

generate_binding() {
  local pkg_name="$1"
  local wasm_name="$2"
  local out_file="$3"
  local wasm_path="$ROOT_DIR/target/wasm32v1-none/release/${wasm_name}.wasm"

  if [[ ! -f "$wasm_path" ]]; then
    echo "==> Building ${pkg_name} WASM first..."
    stellar contract build --package "$pkg_name"
  fi

  echo "==> Generating TypeScript bindings from $wasm_path..."
  rm -rf "$BINDINGS_TMP"
  stellar contract bindings typescript \
    --wasm "$wasm_path" \
    --output-dir "$BINDINGS_TMP" \
    --overwrite

  cp "$BINDINGS_TMP/src/index.ts" "$GENERATED_DIR/$out_file"
  rm -rf "$BINDINGS_TMP"
  echo "==> Contract bindings written to packages/sdk/src/generated/$out_file"
}

generate_binding "registry" "registry" "contract.ts"
generate_binding "passkey_account" "passkey_account" "passkey_account.ts"
generate_binding "account_factory" "account_factory" "account_factory.ts"
