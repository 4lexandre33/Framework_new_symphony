# MCP da engine — guia de uso

Servidor [Model Context Protocol](https://modelcontextprotocol.io) com **75
ferramentas** para uma IA trabalhar na engine e nos jogos: ler o manual, criar e
checar jogos, rodar os gates, controlar um jogo aberto, editar cenas/assets e
preparar builds/Steam. Especificação: [`SPEC.md`](./SPEC.md) · plano:
[`TASK_GRAPH.md`](./TASK_GRAPH.md) · para quem mexe no servidor:
[`tools/mcp/README.md`](../../tools/mcp/README.md).

## Instalar
```
npm install          # traz @modelcontextprotocol/sdk, zod, tsx, ws
npm run mcp          # sobe o servidor por stdio (o cliente MCP faz isso sozinho)
```
Opcional, para `runtime_launch` (jogo em Chromium headless): `npm i -D playwright`
e `npx playwright install chromium`. Sem isso, use `runtime_connect_info` e abra o
jogo no seu navegador ou no `tauri dev`.

## Registrar no cliente
**Claude Code** — já está em `.mcp.json` na raiz; basta abrir o repositório e
aprovar o servidor `engine`.

**Claude Desktop / Cursor / outros** — adicione (ajuste o caminho):
```json
{
  "mcpServers": {
    "engine": {
      "command": "npx",
      "args": ["tsx", "tools/mcp/src/server.ts"],
      "cwd": "C:/caminho/para/framework_new_symphony"
    }
  }
}
```
Variáveis opcionais: `ENGINE_MCP_ROOT` (raiz do repo), `ENGINE_MCP_READONLY=1`
(nenhuma escrita), `ENGINE_MCP_BRIDGE_PORT` (padrão 47100),
`ENGINE_MCP_IMPORT_DIR` (pasta extra de onde `asset_import` pode copiar).

## O que dá para fazer
| Área | Ferramentas |
|---|---|
| Manual | `engine_info`, `docs_index`, `docs_read`, `docs_search`, `module_api`, `gaps_list`, `recipes_list`, `recipe_read` + resources `engine://…` + prompts `criar-jogo`, `corrigir-gate`, `investigar-bug-runtime`, `nova-cena` |
| Jogos | `project_list`, `project_create` (modelos `minimal`/`physics`), `project_files`, `project_read_file`, `project_write_file`, `project_report_append`, `project_check`, `project_delete` |
| Gates | `gate_run` (tsc, test, arch, isolation, agents, stage90, ai-manual, build, cargo-check, cargo-test, diff-check, all), `gate_result`, `test_run`, `audit_run`, `job_list/status/log/cancel` |
| Jogo rodando | `runtime_launch`, `runtime_connect_info`, `runtime_status`, `runtime_stop`, `kernel_inspect`, `loop_control` (pausar/retomar/avançar ticks), `world_entities/entity/spawn/despawn/patch/snapshot`, `physics_raycast/stats`, `camera_get/set`, `input_send`, `events_subscribe/tail`, `commands_send`, `logs_tail`, `screenshot`, `perf_stats`, `storage_slots`, `scene_load_live` |
| Cenas e assets | `scene_list/read/create/validate`, `scene_entity_add/update/remove`, `prefab_list/read/create/update`, `assets_list`, `assets_validate`, `asset_import`, `gltf_inspect` |
| Build e Steam | `desktop_config_get/set`, `build_web`, `build_desktop`, `build_artifacts`, `steam_config_get/set`, `steam_achievements_check`, `steam_pipeline_prepare`, `steam_appid_check` |

Exemplos de pedidos para a IA:
- "Crie o jogo `corrida` com o modelo physics e rode o `project_check`."
- "Abra o physics-sandbox headless, pause, avance 30 ticks e me mande um screenshot."
- "Monte a cena `fase-1` com 10 caixas usando o prefab `caixa` e carregue no jogo aberto."
- "Gere os VDFs do SteamPipe para o appId do `steam.json`."

## Jogo rodando (DevBridge)
O jogo conecta no MCP por WebSocket local com token (`ws://127.0.0.1:<porta>`).
A ponte (`src/debug/devbridge/`) só existe em **modo desenvolvimento** e só liga
com `?devbridge=…&devtoken=…` na URL ou `VITE_DEVBRIDGE_URL`/`VITE_DEVBRIDGE_TOKEN`;
o build de produção não contém a ponte (há teste para isso).
- Automático: `runtime_launch { id }` sobe o Vite + Chromium headless já conectado.
- Manual: `runtime_connect_info { id }` devolve a URL para o navegador e o comando
  para o `tauri dev` (`node scripts/tauri-project-config.mjs <id> --dev` com as
  variáveis indicadas).

WebGL headless usa SwiftShader (≈ 8 fps): ótimo para inspecionar e testar, não
para medir desempenho.

## Segurança
- Caminhos sempre dentro do repositório (sem `..`, sem link simbólico para fora).
- Escrita só em `src/projects/<jogo>/`, `docs/games/<jogo>/`, `src-tauri/gen/` e `dist/`;
  nunca na engine nem nas baselines. `ENGINE_MCP_READONLY=1` bloqueia tudo.
- Comandos externos por lista fixa (node/npm/npx/cargo e git só leitura), sem shell.
- A ponte aceita só loopback, exige token, tem lista fechada de métodos e não tem `eval`.
- Steam: o MCP gera arquivos e o comando `steamcmd`; nunca pede nem guarda senha.

## Limites
- Recertificar baselines Layer-1 continua manual (fluxo em `docs/ai/RULES.md`).
- `build_desktop`/`cargo-*` exigem Rust e o Tauri CLI instalados; builds de outro SO não são gerados.
- O que depende de Steam real ou janela Tauri real segue como **NV** em `docs/ai/GAPS.md`.

## Testes
`npx vitest run tests/mcp` (cliente MCP real em memória contra o servidor real) ·
e2e com Chromium: `ENGINE_MCP_E2E=1 npx vitest run tests/mcp/e2e`.
