# Layer 1 — Validação, evidências e freeze

Princípio: **evidência acima de documentação.** Nenhuma stage é concluída porque
um arquivo de texto ou markdown diz PASS. O PASS vem da execução dos validadores.

## 1. Gates globais

Após qualquer mudança de código:

```bash
npm run arch:check
npx tsc --noEmit
npx vitest run
npm run build
```

`npm run build` executa `arch:check`, `tsc` e `vite build` nessa ordem. Se o
Rust/Tauri foi tocado:

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Se o runtime desktop está no escopo, use o smoke disponível ou
`npm run tauri dev`, quando o ambiente permitir. Um teste com mock não prova
execução nativa.

## 2. Validadores por stage

| Stage | Comandos | Observação |
|---|---|---|
| 71–84 | `scripts/architecture/stageNN-audit-*.mjs` e `stageNN-validate-*.mjs` | Execução direta com `node` |
| 85 | `npm run stage85:audit`, `stage85:validate`, `stage85:smoke`, `stage85:finalize` | O smoke abre a janela nativa; o `finalize` exige o shutdown observado |
| 86 | `npm run stage86:audit`, `stage86:validate`, `stage86:smoke`, `stage86:finalize` | `tests/run-stage86-performance-smoke.mjs` |
| 87 | `npm run stage87:audit`, `stage87:validate`, `stage87:smoke`, `stage87:finalize` | `tests/run-stage87-resilience-smoke.mjs` |
| 88 | `npm run stage88:audit`, `stage88:validate`, `stage88:finalize` | Releases reais Linux e Windows no CI |
| 89 | `npm run stage89:audit`, `stage89:validate`, `stage89:finalize` | Valida esta documentação e suas referências |

O `validate` encadeia auditoria semântica, testes focados, regressões, `arch:check`,
`tsc`, a suíte completa do Vitest, `cargo check` e `vite build`. Nas Stages 86,
87 e 89 o `finalize` reexecuta o `validate` e só grava as evidências se ele
passar. Na Stage 88 o `finalize` exige as evidências reais dos smokes de release
(Linux e Windows) e um audit sem violações.

## 3. Evidências geradas

Para as stages 85–88, cada stage produz na raiz:

- `ETAPA<NN>_MANIFEST.json` — o que a stage inclui;
- `ETAPA<NN>_AUTOMATED_PASS.json` — o resultado dos gates, com `violations`;
- `ETAPA<NN>_*_EVIDENCE.json` — evidência de runtime/produção;
- `ETAPA<NN>_SHA256SUMS.txt` — checksums dos arquivos da stage.

Uma stage seguinte só é finalizada se as anteriores estiverem `PASS` com zero
violações (por exemplo, o validador da Stage 88 exige as Stages 86 e 87).

**Nota sobre checksums.** O `ETAPA88_SHA256SUMS.txt` foi gerado no runner Windows,
com fins de linha CRLF nos arquivos de texto. Ao verificá-lo em Linux/macOS,
compare com a versão CRLF do arquivo. A auditoria da Stage 88 normaliza
CRLF/LF antes dos checks de texto.

## 4. Freeze arquitetural

O lock canônico é `.freeze-lock.json`; o orquestrador é `agents.mjs`.

```bash
node agents.mjs            # verificar
node agents.mjs --unlock   # desbloqueio controlado (exige autorização)
node agents.mjs --lock     # gerar/atualizar o lock
```

Nunca edite ou apague `.freeze-lock.json` à mão, nunca desative verificações
para obter PASS e nunca desbloqueie módulos protegidos sem autorização.

## 5. CI

Os workflows de certificação ficam em `.github/workflows/`:

- `.github/workflows/stage86-performance.yml`
- `.github/workflows/stage87-resilience.yml`
- `.github/workflows/stage88-production.yml`

Disparam em `push` na branch `teste/cena-3d-tauri`, filtrados por arquivos da
stage, e manualmente por `workflow_dispatch`. O commit de certificação é feito
pelo `github-actions[bot]`. A Stage 89 é uma stage de documentação e não precisa
de build nativo; seus gates rodam localmente.

## 6. Falha e bloqueio

Um ticket deve ficar **bloqueado** em vez de produzir falso PASS quando uma
dependência não está concluída, a fonte de verdade é contraditória, falta um SDK
obrigatório ou a validação exigida não pode ser executada. `BLOCKED` nunca vira
`PASS`.
