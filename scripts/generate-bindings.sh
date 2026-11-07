#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

WASM_PATH="$ROOT_DIR/target/wasm32v1-none/release/registry.wasm"
BINDINGS_TMP="$ROOT_DIR/packages/sdk/generated-tmp"
GENERATED_DIR="$ROOT_DIR/packages/sdk/src/generated"

if [[ ! -f "$WASM_PATH" ]]; then
  echo "==> Building registry WASM first..."
  stellar contract build --package registry
fi

echo "==> Generating TypeScript bindings from $WASM_PATH..."
rm -rf "$BINDINGS_TMP"
stellar contract bindings typescript \
  --wasm "$WASM_PATH" \
  --output-dir "$BINDINGS_TMP" \
  --overwrite

mkdir -p "$GENERATED_DIR"
cp "$BINDINGS_TMP/src/index.ts" "$GENERATED_DIR/contract.ts"
rm -rf "$BINDINGS_TMP"

echo "==> Contract bindings written to packages/sdk/src/generated/contract.ts"
