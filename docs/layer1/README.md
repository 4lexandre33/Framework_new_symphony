# Projeto1 — Layer 1 (Engine / Infraestrutura)

**Status:** certificada por stages até a Stage 88; documentada na Stage 89  
**Baseline arquitetural:** v20  
**Escopo:** `src/core/**`, `src/engine/**`, `src/plugins/**`, `src/contracts/**`, `src/tokens/**` e `src-tauri/**`  
**Pendente:** Stage 90 (gate final da Layer 1). Este documento **não** declara `LAYER 1 PASS`.

## 1. O que é a Layer 1

A Layer 1 é a base técnica de execução: microkernel, plugins, capabilities,
game loop, renderização, física, input, assets, rede, armazenamento, áudio, UI e
a integração nativa com Tauri/Rust e Steam. Ela hospeda a Layer 2 (Domain), a
Layer 3 (Services) e a Layer 4 (App), mas não depende delas.

```text
Core / Kernel          lifecycle, plugins, capabilities, eventos, comandos, queries
Layer 1 — Engine       loop, render, física, input, assets, world, áudio, UI, net, Steam, Tauri
Layer 2 — Domain       regras e estado semântico (ver docs/layer2/README.md)
Layer 3 — Services     casos de uso e orquestração
Layer 4 — App          bootstrap, composição e fluxos de produto
```

A fonte canônica dos módulos é `scripts/architecture/module-map.mjs`. No estado
atual ela descreve **23 módulos**: 20 funcionais e 3 runtimes (`game-loop`,
`render` e `net`).

| Tipo | Módulos |
|---|---|
| Runtimes | `game-loop`, `render`, `net` |
| Funcionais | `steam`, `input`, `assets`, `physics`, `storage`, `world`, `ui`, `anim`, `sprites`, `audio`, `camera`, `ai`, `vfx`, `terrain`, `scripting`, `streaming`, `overlay`, `security`, `modding`, `monetization` |

Cada módulo mantém a separação física `public/` (API) e `internal/`
(implementação). Código externo ao módulo usa somente a API pública.

## 2. Stages certificadas

Cada stage possui um documento técnico na raiz, um manifesto e validadores
executáveis em `scripts/architecture/`. O documento de uma stage descreve o que
foi certificado; a prova é a execução do validador, não o texto.

| Stage | Tema | Documento técnico |
|---|---|---|
| 71 | Baseline e inventário | `ETAPA71_LAYER1_BASELINE.txt` |
| 72 | APIs públicas, contracts e tokens | `ETAPA72_PUBLIC_APIS_CONTRACTS_TOKENS.txt` |
| 73 | Manifestos de plugin e grafo de capabilities | `ETAPA73_PLUGIN_MANIFESTS_CAPABILITY_GRAPH.txt` |
| 74 | Lifecycle, boot e shutdown | `ETAPA74_LAYER1_LIFECYCLE.txt` |
| 75 | Game loop determinístico | `ETAPA75_DETERMINISTIC_GAME_LOOP.txt` |
| 76 | Runtime de renderização | `ETAPA76_RENDERING_RUNTIME.txt` |
| 77 | Runtime de física | `ETAPA77_PHYSICS_RUNTIME.txt` |
| 78 | Runtime de input | `ETAPA78_INPUT_RUNTIME.txt` |
| 79 | Assets, streaming, terrain e workers | `ETAPA79_ASSETS_STREAMING_TERRAIN_WORKERS.txt` |
| 80 | Sistemas de apresentação | `ETAPA80_PRESENTATION_SYSTEMS.txt` |
| 81 | World, AI e scripting | `ETAPA81_WORLD_AI_SCRIPTING.txt` |
| 82 | Storage e persistência | `ETAPA82_STORAGE_PERSISTENCE.txt` |
| 83 | Runtime de rede | `ETAPA83_NETWORKING_RUNTIME.txt` |
| 84 | Integração Steamworks | `ETAPA84_STEAMWORKS_INTEGRATION.txt` |
| 85 | Infraestrutura nativa Tauri | `ETAPA85_NATIVE_TAURI_INFRASTRUCTURE.txt` |
| 86 | Performance e ciclo de vida de recursos | `ETAPA86_PERFORMANCE_RESOURCE_LIFECYCLE.txt` |
| 87 | Recuperação de falhas e resiliência | `ETAPA87_FAILURE_RECOVERY_RESILIENCE.txt` |
| 88 | Produção desktop / Steam | `ETAPA88_DESKTOP_STEAM_PRODUCTION_READINESS.txt` |
| 89 | Documentação da Layer 1 | `ETAPA89_LAYER1_DOCUMENTATION.txt` |

As baselines congeladas de cada área ficam na raiz como
`LAYER1_*_BASELINE_V1.json`.

## 3. Mapa da documentação

| Documento | Conteúdo |
|---|---|
| `docs/layer1/runtime-lifecycle.md` | Kernel, boot/shutdown, game loop, ownership de recursos e recuperação de falhas |
| `docs/layer1/native-tauri-steam.md` | Host Tauri/Rust, comandos IPC, segurança, Steam opcional, build e empacotamento |
| `docs/layer1/consumer-projects.md` | Como um jogo/app consome a engine sem alterá-la |
| `docs/layer1/validation-evidence.md` | Gates, validadores por stage, evidências, freeze e CI |
| `docs/layer2/README.md` | Domain Layer 2 |

Regras permanentes de engenharia: `AGENTS.md`. Processo do Symphony:
`WORKFLOW.md`. Destino e roteiro: `SPEC.md`.

## 4. Limites conhecidos desta documentação

- Ela descreve o estado verificável no checkout. Onde algo depende de execução
  em hardware ou sistema que o CI não cobre, isso está dito explicitamente.
- A API pública de distribuição do framework (`defineProject`,
  `createApplication`, packages e presets) pertence às Stages 91–116 e **não**
  existe ainda. `src/project.ts` é uma composição local transitória.
