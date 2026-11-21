#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

OUTPUT_JSON=""
BASELINE_JSON=""
OUTPUT_MD=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-json)
      OUTPUT_JSON="${2:?Missing value for --output-json}"
      shift 2
      ;;
    --baseline)
      BASELINE_JSON="${2:?Missing value for --baseline}"
      shift 2
      ;;
    --output-md)
      OUTPUT_MD="${2:?Missing value for --output-md}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

# Soroban on-chain contract size limit is 64 KiB (65,536 bytes).
declare -A BUDGETS=(
  ["registry"]="${REGISTRY_SIZE_BUDGET:-65536}"
  ["passkey_account"]="${PASSKEY_ACCOUNT_SIZE_BUDGET:-65536}"
  ["account_factory"]="${ACCOUNT_FACTORY_SIZE_BUDGET:-65536}"
)

echo "==> Building Soroban contracts with stellar-cli (--features opt)..."
stellar contract build -- --features opt

WASM_DIR="$ROOT_DIR/target/wasm32v1-none/release"
CONTRACTS=("registry" "passkey_account" "account_factory")

declare -A SIZES=()
BUDGET_FAILED=0

for contract in "${CONTRACTS[@]}"; do
  wasm_path="$WASM_DIR/${contract}.wasm"
  if [[ ! -f "$wasm_path" ]]; then
    echo "Error: WASM artifact not found at $wasm_path" >&2
    exit 1
  fi
  size_bytes=$(wc -c < "$wasm_path" | tr -d ' ')
  SIZES["$contract"]="$size_bytes"
  budget="${BUDGETS[$contract]}"
  if (( size_bytes > budget )); then
    BUDGET_FAILED=1
  fi
done

if [[ -n "$OUTPUT_JSON" ]]; then
  cat > "$OUTPUT_JSON" <<EOF
{
  "registry": ${SIZES["registry"]},
  "passkey_account": ${SIZES["passkey_account"]},
  "account_factory": ${SIZES["account_factory"]}
}
EOF
fi

read_json_value() {
  local json_file="$1"
  local key="$2"
  if [[ -z "$json_file" || ! -f "$json_file" ]]; then
    echo ""
    return
  fi
  python3 -c "import json, sys; d=json.load(open(sys.argv[1])); print(d.get(sys.argv[2], ''))" "$json_file" "$key"
}

MD_CONTENT="<!-- soroban-wasm-size-report -->
### Soroban WASM Binary Size Report (\`--features opt\`)

| Contract | Base Size (B) | PR Size (B) | Diff (B) | Diff (%) | Budget (B) | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |"

for contract in "${CONTRACTS[@]}"; do
  pr_size="${SIZES[$contract]}"
  budget="${BUDGETS[$contract]}"
  base_size="$(read_json_value "$BASELINE_JSON" "$contract")"

  if [[ -n "$base_size" && "$base_size" =~ ^[0-9]+$ && "$base_size" -gt 0 ]]; then
    diff_bytes=$(( pr_size - base_size ))
    if (( diff_bytes > 0 )); then
      diff_str="+${diff_bytes}"
    else
      diff_str="${diff_bytes}"
    fi
    diff_pct=$(awk -v d="$diff_bytes" -v b="$base_size" 'BEGIN { printf "%+.2f%%", (d / b) * 100 }')
  else
    base_size="—"
    diff_str="—"
    diff_pct="—"
  fi

  if (( pr_size > budget )); then
    status="❌ Exceeds budget"
  else
    status="✅ Within budget"
  fi

  MD_CONTENT="${MD_CONTENT}
| \`${contract}.wasm\` | ${base_size} | ${pr_size} | ${diff_str} | ${diff_pct} | ${budget} | ${status} |"
done

if [[ -n "$OUTPUT_MD" ]]; then
  printf "%s\n" "$MD_CONTENT" > "$OUTPUT_MD"
else
  printf "%s\n" "$MD_CONTENT"
fi

if (( BUDGET_FAILED != 0 )); then
  echo "Error: One or more Soroban contracts exceeded their WASM size budget." >&2
  exit 1
fi
