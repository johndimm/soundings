#!/usr/bin/env bash
# Run dual-mode Soundings taste tests (All channel vs channel hint).
# Usage: ./scripts/taste-test-all.sh [base-url] [max-rounds] [count]
#
# Examples:
#   ./scripts/taste-test-all.sh                          # direct LLM, deepseek, 15 rounds, 5 profiles
#   ./scripts/taste-test-all.sh http://127.0.0.1:8000 12 3
#   ./scripts/taste-test-all.sh deepseek 12 3          # direct LLM, explicit provider

set -euo pipefail
cd "$(dirname "$0")/.."

BASE=${1:-}
MAX=${2:-15}
COUNT=${3:-5}

if [[ -z "$BASE" ]]; then
  exec npx tsx scripts/taste-test-all.ts deepseek "$MAX" "$COUNT"
fi

exec npx tsx scripts/taste-test-all.ts "$BASE" "$MAX" "$COUNT"
