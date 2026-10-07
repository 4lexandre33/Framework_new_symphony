#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || -z "${1// }" ]]; then
  printf 'Uso: %s TERMO [MAX_LINHAS: 1..150]\n' "$0" >&2
  exit 2
fi

term=$1
limit=${2:-60}
if ! [[ "$limit" =~ ^[0-9]+$ ]] || (( limit < 1 || limit > 150 )); then
  printf 'MAX_LINHAS deve estar entre 1 e 150.\n' >&2
  exit 2
fi

repo=$(git rev-parse --show-toplevel)
cd "$repo"
printf 'Repo: %s\nBusca: %s\nMáximo: %s linhas\n' "$repo" "$term" "$limit"

if command -v rg >/dev/null 2>&1; then
  rg --line-number --no-heading --color never --fixed-strings --max-count 3 \
    --glob '!**/node_modules/**' --glob '!**/dist/**' --glob '!**/target/**' \
    -- "$term" src tests scripts | sed -n "1,${limit}p" || true
else
  git grep --line-number -I -F -e "$term" -- src tests scripts \
    | sed -n "1,${limit}p" || true
fi
