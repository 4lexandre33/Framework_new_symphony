#!/usr/bin/env bash
set -euo pipefail

repo=$(git rev-parse --show-toplevel)
cd "$repo"
printf '=== CHECKOUT ===\n'
git log -1 --oneline
printf '\n=== STATUS ===\n'
git status --short
printf '\n=== DIFF ESTATISTICO ===\n'
git diff --stat
printf '\n=== DIFF CHECK ===\n'
git diff --check
printf '\n=== DOCUMENTOS ===\n'
for name in WORKFLOW.md AGENTS.md SPEC.md; do
  if [[ -f "$name" ]]; then
    printf '%s: OK\n' "$name"
  else
    printf '%s: AUSENTE\n' "$name"
  fi
done
