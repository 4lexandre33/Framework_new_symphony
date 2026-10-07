#!/usr/bin/env bash
set -euo pipefail

repo=$(git rev-parse --show-toplevel)
cd "$repo"

case "${1:-}" in
  focused)
    shift
    if [[ $# -eq 0 ]]; then
      printf 'Uso: %s focused tests/arquivo.test.ts [outros arquivos]\n' "$0" >&2
      exit 2
    fi
    npm exec -- vitest run "$@"
    ;;
  full)
    if [[ $# -ne 1 ]]; then
      printf 'Uso: %s full\n' "$0" >&2
      exit 2
    fi
    npm test
    npm run build
    git diff --check
    ;;
  *)
    printf 'Uso: %s focused <teste...> | full\n' "$0" >&2
    exit 2
    ;;
esac
