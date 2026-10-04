# Stage 43 — Permanent Architecture Integration

**ETAPA 43: PASS**

## Permanent npm integration

- `arch:audit`: `node agents.mjs`
- `arch:check`: `node scripts/architecture/check-boundaries.mjs && node scripts/architecture/check-dependencies.mjs`
- `arch:dependencies`: `node scripts/architecture/check-dependencies.mjs`
- `arch:migrate`: `node scripts/architecture/stage43-migration-status.mjs`
- `build`: `npm run arch:check && tsc && vite build`

## agents.mjs

- freeze invariants: PASS
- freeze lock: PASS
- boundary checker: PASS
- dependency graph: PASS
- `--lock`: preserved
- `--unlock`: preserved

## Windows process execution

- npm scripts use explicit `cmd.exe /d /s /c` on Windows.
- direct `spawnSync("npm.cmd", ...)` is not used.
- `shell:true` is not required.

## Validation

- migration status v20: PASS
- `npm run arch:migrate`: PASS, read-only
- `npm run arch:check`: PASS
- `npm run arch:dependencies`: PASS
- `npm run arch:audit`: PASS
- `npm run build`: PASS

No blocking item remains in Stage 43.
