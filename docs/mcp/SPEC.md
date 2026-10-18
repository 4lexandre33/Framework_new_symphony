# MCP da engine — especificação (v1)

Servidor **Model Context Protocol** que deixa uma IA (Claude Code, Claude Desktop,
Cursor, qualquer cliente MCP) trabalhar na engine e nos jogos sem adivinhar:
lê o manual, cria jogos, roda os gates, conecta num jogo aberto, edita cenas e
prepara builds/Steam. O plano de execução (grafo de tarefas) está em
[`TASK_GRAPH.md`](./TASK_GRAPH.md).

## 1. Princípios

1. **A engine não depende do MCP.** O servidor vive em `tools/mcp/` (Node), fora
   de `src/`. A única peça dentro do app é o **DevBridge** (`src/debug/devbridge/`),
   ligado só em build de desenvolvimento e só com URL + token explícitos.
2. **Seguro por padrão.**
   - Todo caminho é resolvido dentro da raiz do repositório (sem `..`, sem link
     simbólico para fora). Escrita só em `src/projects/<id>/`, `docs/games/<id>/`
     e `src-tauri/gen/` (nunca na engine).
   - Comandos externos só de uma lista fixa (npm/npx/node/cargo/git leitura);
     nunca shell livre, nunca `eval` no jogo.
   - O DevBridge só aceita `ws://127.0.0.1` / `ws://localhost`, exige token,
     tem lista fechada de métodos e não existe no bundle de produção.
3. **Respostas estruturadas.** Toda tool devolve JSON (`structuredContent`) +
   resumo curto em texto. Erros: `isError: true` + `{ code, message, hint? }`.
4. **Tarefas longas viram jobs** (build, testes, tauri build): a tool devolve
   `jobId` na hora; `job_status`/`job_log`/`job_cancel` acompanham.
5. **Sem rede obrigatória.** Nada depende de internet; Steam/upload só gera
   arquivos e comandos para o usuário rodar.

## 2. Arquitetura

```
cliente MCP (Claude Code…) ──stdio──▶ tools/mcp/src/server.ts
                                       ├─ tools/knowledge.ts   (manual, GAPS, receitas)
                                       ├─ tools/projects.ts    (jogos)
                                       ├─ tools/gates.ts       (tsc, testes, auditorias)
                                       ├─ tools/jobs.ts        (jobs longos)
                                       ├─ tools/runtime.ts ──ws──▶ DevBridge no jogo (navegador/Tauri dev)
                                       ├─ tools/scenes.ts      (cenas/prefabs JSON)
                                       ├─ tools/assets.ts      (assets)
                                       └─ tools/build.ts       (web/desktop/Steam)
```

- Linguagem: TypeScript executado por `tsx` (`npm run mcp` = `tsx tools/mcp/src/server.ts`).
  Type-check próprio: `tools/mcp/tsconfig.json` (`npm run mcp:typecheck`).
- Dependências novas (devDependencies): `@modelcontextprotocol/sdk`, `zod`, `tsx`.
  `ws` já existe. Playwright é **opcional** (só para `runtime_launch` headless):
  `node_modules/playwright` ou `/opt/npm-tools`; sem ele, modo externo.
- Registro: `.mcp.json` na raiz (Claude Code); `docs/mcp/README.md` mostra
  Claude Desktop/Cursor.
- Testes: `tests/mcp/*.test.ts` (vitest) usando `InMemoryTransport` do SDK
  (cliente MCP real ↔ servidor real); e2e do runtime em `tests/mcp/e2e/`.

### 2.1 Núcleo do servidor (`tools/mcp/src/core/`)
| Arquivo | Responsabilidade |
|---|---|
| `server.ts` (em `src/`) | cria `McpServer`, registra domínios, stdio |
| `core/registry.ts` | `defineTool({ name, title, description, input: zod, output?: zod, run })` + `registerDomain(server, tools)`; envelope de erro/sucesso padronizado |
| `core/paths.ts` | `repoRoot()`, `resolveInRepo(rel)`, `assertWritable(rel)`, `projectDir(id)`, validação de id `[a-z0-9][a-z0-9-]{0,62}` |
| `core/exec.ts` | `runAllowed(cmd, args, { cwd, timeoutMs, env })` com allowlist, captura stdout/stderr com limite (2 MiB) |
| `core/jobs.ts` | `JobManager`: start/status/log(offset)/cancel, até 4 jobs simultâneos, log em anel 4 MiB, expira 1 h |
| `core/errors.ts` | `McpToolError(code, message, hint)` |
| `core/config.ts` | variáveis: `ENGINE_MCP_ROOT`, `ENGINE_MCP_BRIDGE_PORT` (padrão 47100), `ENGINE_MCP_READONLY=1` (desliga escrita) |

## 3. Catálogo de tools

Formato: `nome(entrada) → saída`. `id` = id de projeto. Todas validadas com zod.

### 3.1 Conhecimento (`knowledge`)
| Tool | Entrada | Saída |
|---|---|---|
| `engine_info` | — | versão, branch/commit, nº módulos, lista de capabilities, jogos, status do freeze-lock |
| `docs_index` | — | conteúdo de `docs/ai/INDEX.md` estruturado (módulos, tokens, tamanho) |
| `docs_read` | `{ doc: "RULES"\|"CORE"\|"RECIPES"\|"GAPS"\|"INDEX" }` ou `{ module }` ou `{ note }` | markdown |
| `docs_search` | `{ query, limit? }` | trechos com caminho/linha (busca em `docs/ai`, `docs/layer1`, receitas) |
| `module_api` | `{ module }` | token (métodos/assinaturas), eventos, comandos, contratos, notas, gaps do módulo |
| `gaps_list` | `{ module?, severity? }` | linhas abertas de `docs/ai/GAPS.md` |
| `recipes_list` / `recipe_read` | — / `{ name }` | receitas de `src/projects/_template/recipes` |

Resources MCP: `engine://docs/{RULES,CORE,RECIPES,GAPS,INDEX}`, `engine://module/{key}`,
`engine://recipe/{name}`, `engine://project/{id}/report` (ENGINE_REPORT.md).
Prompts MCP: `criar-jogo`, `corrigir-gate`, `investigar-bug-runtime`, `nova-cena`.

### 3.2 Projetos (`projects`)
| Tool | Entrada | Saída |
|---|---|---|
| `project_list` | — | `[{ id, name, path, hasDesktopJson, hasReport, files }]` |
| `project_create` | `{ id, name, template?: "minimal"\|"physics" , withDesktopJson? }` | arquivos criados; o jogo aparece no seletor (descoberta automática) |
| `project_files` | `{ id }` | árvore de arquivos do jogo |
| `project_read_file` / `project_write_file` | `{ id, path, content? }` | só dentro de `src/projects/<id>/` (texto ≤ 1 MiB) |
| `project_report_append` | `{ id, module, kind: "bug"\|"gap"\|"ok", text }` | anexa ao `ENGINE_REPORT.md` |
| `project_check` | `{ id }` | tsc só dos arquivos do jogo + isolamento + testes do jogo (resumo) |
| `project_delete` | `{ id, confirm: id }` | remove a pasta do jogo (nunca `_template`) |

### 3.3 Gates (`gates`) e jobs
| Tool | Entrada | Saída |
|---|---|---|
| `gate_run` | `{ gate: "tsc"\|"test"\|"arch"\|"isolation"\|"agents"\|"stage90"\|"ai-manual"\|"build"\|"cargo-check"\|"cargo-test"\|"diff-check"\|"all", async? }` | `{ ok, durationMs, summary, failures:[{ file, line?, message }] }` ou `jobId` |
| `test_run` | `{ files?: string[], namePattern? }` | resultados por arquivo/teste (reporter JSON do vitest) |
| `audit_run` | `{ stage: 71..90 }` | violações estruturadas da auditoria Layer-1 |
| `job_status` / `job_log` / `job_cancel` / `job_list` | `{ jobId, offset? }` | estado, código de saída, trecho do log |

Gates que exigem destravar baselines **não** são executados pelo MCP (o
fluxo de recertificação continua manual: `docs/ai/RULES.md`).

### 3.4 Runtime — jogo rodando (`runtime` + DevBridge)
Conexão: o servidor MCP abre um WebSocket em `127.0.0.1:<porta>` com token
aleatório por sessão. O jogo (dev) conecta como cliente:
`http://localhost:1420/?project=<id>&devbridge=ws://127.0.0.1:47100&devtoken=<token>`
(ou `VITE_DEVBRIDGE_URL`/`VITE_DEVBRIDGE_TOKEN` no `tauri dev`).

| Tool | Entrada | Saída |
|---|---|---|
| `runtime_launch` | `{ id, headless?: true, width?, height? }` | sobe `vite` (porta livre) com o projeto + Chromium headless (Playwright) já apontado para o bridge; devolve `sessionId` |
| `runtime_connect_info` | `{ id }` | URL/token para abrir manualmente (navegador ou `tauri dev`) |
| `runtime_status` | — | sessões conectadas: projeto, kernel status, fps, uptime |
| `runtime_stop` | `{ sessionId }` | fecha navegador/vite lançados |
| `kernel_inspect` | `{ sessionId }` | `kernel.inspect()` (plugins, capabilities, slots, bootOrder) |
| `loop_control` | `{ action: "pause"\|"resume"\|"step", ticks? }` | estado do loop (`getStats`) |
| `world_entities` | `{ type?, tag?, near?:{x,y,z,r}, limit? }` | snapshots de entidades |
| `world_entity` | `{ entityId }` | snapshot completo |
| `world_spawn` / `world_despawn` / `world_patch` | spawn input / id / patch | resultado |
| `world_snapshot` | — | `serializeWorldState()` |
| `physics_raycast` | `{ origin, direction, maxDistance }` | hit |
| `physics_stats` | — | `getStats()` |
| `camera_get` / `camera_set` | — / `{ cameraId? , followTargetId? }` | snapshot |
| `input_send` | `{ keys?:[{code,down}], pointer?:{x,y,buttons}, wheel? }` | eventos DOM sintéticos |
| `events_subscribe` | `{ patterns: string[] }` (ex.: `game.world.*`) | ok; eventos vão para um buffer |
| `events_tail` | `{ since?, limit? }` | eventos capturados (payload truncado 8 KiB) |
| `commands_send` | `{ command, payload }` | só comandos `game.*` registrados (`commands.request`) |
| `logs_tail` | `{ level?, since?, limit? }` | console capturado (log/warn/error + erros não tratados) |
| `screenshot` | `{ maxWidth? }` | imagem PNG (MCP `image` content) do canvas/página |
| `perf_stats` | — | fps, frame time, draw calls, memória (`performance.memory` se houver) |
| `storage_slots` | — | `listSaves()` |
| `scene_load_live` | `{ id, scene }` | carrega um arquivo de cena no jogo rodando (ver 3.5) |

DevBridge (`src/debug/devbridge/`): `DevBridge.ts` (cliente ws, handshake
`{type:"hello", token, project, kernelApiVersion}`), `methods.ts` (tabela fechada
método → função sobre `EngineServices` + `Kernel`), `capture.ts` (console/erros/eventos
em anel), `protocol.ts` (tipos compartilhados com `tools/mcp/src/runtime/protocol.ts`
— mesmo arquivo importado pelos dois lados). Ligado em `src/app/bootstrap.ts`
por `import.meta.env.DEV && devbridge-url-presente` via `import()` dinâmico,
para não entrar no bundle de produção (teste confere `dist/`).

Engine (pequeno, aditivo): `GameLoopApi.stepTicks(n)` quando pausado (para
`loop_control step`). Nada mais muda na engine para o runtime.

### 3.5 Cenas, prefabs e assets (`scenes`, `assets`)
Formato novo, versionado, **opcional** para os jogos (o código continua podendo
spawnar à mão). Vive em `src/projects/<id>/scenes/*.scene.json` e
`src/projects/<id>/prefabs/*.prefab.json`.

```jsonc
// SceneDocument v1  (contrato: src/contracts/world/scene-document.ts)
{
  "format": "engine.scene", "version": 1,
  "sceneId": "fase-1", "sceneName": "Fase 1",
  "assets": [{ "id": "trem", "url": "/assets/trem.glb", "type": "gltf" }],
  "worldBounds": { "min": {"x":-100,"y":-10,"z":-100}, "max": {"x":100,"y":50,"z":100} },
  "entities": [
    { "id": "player", "type": "player", "prefab": "jogador",          // prefab opcional
      "position": {"x":0,"y":1,"z":0}, "rotation": {"x":0,"y":0,"z":0,"w":1},
      "scale": {"x":1,"y":1,"z":1}, "tags": ["player"], "data": { "vida": 3 } }
  ]
}
// PrefabDocument v1: { "format":"engine.prefab","version":1,"prefabId","type","tags","data","assets" }
```

Engine: `validateSceneDocument(doc)` / `validatePrefabDocument(doc)` puros em
`src/contracts/world/scene-document.ts` (mesmo código usado pelo MCP) e
`WorldApi.loadSceneDocument(doc, { prefabs?, ...SceneLoadOptions })` (pré-carrega
assets, aplica prefabs — campos da entidade sobrescrevem os do prefab — e spawna;
erros = `false` + evento `game.world.scene-document-error`). Receita nova
`16-scene-document.ts` no template.

| Tool | Entrada | Saída |
|---|---|---|
| `scene_list` / `prefab_list` | `{ id }` | arquivos + resumo (nº entidades, assets) |
| `scene_read` / `prefab_read` | `{ id, scene }` | documento |
| `scene_create` | `{ id, sceneId, sceneName, from? }` | arquivo novo validado |
| `scene_validate` | `{ id, scene }` | erros de schema, prefab inexistente, asset inexistente, ids repetidos |
| `scene_entity_add` / `scene_entity_update` / `scene_entity_remove` | `{ id, scene, entity / entityId, patch }` | documento atualizado (escrita atômica) |
| `prefab_create` / `prefab_update` | `{ id, prefab }` | arquivo |
| `assets_list` | `{ id? }` | assets em `public/` e `src/projects/<id>/assets/` (tipo, bytes, dimensões) |
| `assets_validate` | `{ id }` | GLB/GLTF (cabeçalho, buffers/imagens externos existentes), PNG/JPG/WebP (dimensões, potência de 2, > 4096), áudio (extensão/tamanho), referências quebradas de cenas/prefabs, arquivos órfãos |
| `asset_import` | `{ id, sourcePath, destName }` | copia arquivo local (dentro do repo ou de `ENGINE_MCP_IMPORT_DIR`) para `src/projects/<id>/assets/` |
| `gltf_inspect` | `{ path }` | nós, malhas, materiais, animações, nº triângulos |

### 3.6 Build e Steam (`build`)
| Tool | Entrada | Saída |
|---|---|---|
| `desktop_config_get` | `{ id }` | `desktop.json` + config mesclada (`buildProjectTauriConfig`) |
| `desktop_config_set` | `{ id, config }` | valida com `buildProjectTauriConfig` e grava |
| `build_web` | `{ id }` | job: `VITE_PROJECT=<id> vite build --outDir dist/<id>`; tamanho dos chunks |
| `build_desktop` | `{ id, bundles?: ["nsis"\|"deb"\|"appimage"\|"msi"] }` | job: `node scripts/tauri-project-config.mjs <id> --build`; caminhos dos instaladores |
| `build_artifacts` | `{ id }` | instaladores/bundles encontrados com tamanho e sha256 |
| `steam_config_get` / `steam_config_set` | `{ id, appId?, depots?, achievements? }` | `src/projects/<id>/steam.json` (appId, depotIds por SO, lista de conquistas/stats) |
| `steam_achievements_check` | `{ id }` | conquistas/stats usadas no código do jogo × declaradas no `steam.json` |
| `steam_pipeline_prepare` | `{ id, branch?, description? }` | gera `src-tauri/gen/steam/<id>/app_build_<appId>.vdf` + `depot_build_<depot>.vdf` apontando para os bundles; devolve o comando `steamcmd +login <usuario> +run_app_build …` (o usuário roda; o MCP nunca guarda senha) |
| `steam_appid_check` | — | `steam_appid.txt`, feature `steam` do Cargo, DLL/SO do redistribuível presentes |

## 4. Erros padronizados (`code`)
`INVALID_INPUT`, `NOT_FOUND`, `PATH_OUTSIDE_REPO`, `WRITE_FORBIDDEN`, `READONLY`,
`PROJECT_EXISTS`, `COMMAND_FAILED`, `TIMEOUT`, `JOB_LIMIT`, `NO_RUNTIME`,
`BRIDGE_TIMEOUT`, `BRIDGE_ERROR`, `PLAYWRIGHT_MISSING`, `SCHEMA_INVALID`,
`COMMAND_NOT_ALLOWED`, `INTERNAL`.

> Implementado: 75 tools. Além da tabela: `engine_ping` (teste de conexão),
> `gate_result` (resultado estruturado de um gate rodado como job) e
> `loop_control` com `action: "stats"`.

## 5. Critérios de aceite (todos obrigatórios)
1. `npm run mcp` sobe e responde `tools/list` com todas as tools da seção 3.
2. Cada tool tem teste em `tests/mcp/` via cliente MCP em memória (sucesso + erro).
3. e2e: `runtime_launch` (projeto `physics-sandbox`, headless) → `kernel_inspect`
   `status=running` → `world_spawn` → `world_entities` contém a entidade →
   `screenshot` devolve PNG não vazio → `scene_load_live` de uma cena de teste →
   `runtime_stop` limpa processos.
4. `npm run build` de produção NÃO contém o DevBridge (teste procura a string
   `devbridge` no `dist/`).
5. Gates do repositório verdes (tsc, vitest, build, arch, agents, stage90,
   isolamento, ai-manual, cargo) e auditorias Layer-1 recertificadas.
6. `docs/mcp/README.md`: instalar, registrar no Claude Code/Desktop/Cursor,
   exemplos de uso; `docs/ai/RULES.md` cita o MCP.
