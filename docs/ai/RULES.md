# Regras para IA — criar jogos sobre esta engine (leia inteiro; é curto)

## Onde escrever
- Todo código de jogo fica em `src/projects/<jogo>/`. É a ÚNICA pasta que você cria/edita para um jogo (assets em `public/projects/<jogo>/...`, URL `/projects/<jogo>/...`).
- Comece copiando `src/projects/_template/` (a pasta `_template` e qualquer pasta `_*` nunca é carregada).
- `index.ts` exporta `project: ProjectDefinition` ({id, name, createPlugins}). O jogo é descoberto sozinho; apagar a pasta remove o jogo.
- Vários jogos: use `VITE_PROJECT=<id>` em `dev`/`tauri`/`build` para fixar o jogo; sem ela o app mostra um seletor (`?project=<id>` na URL escolhe). Um só: é o ativo. Em testes use `createProjectPlugins("<id>")` explícito.
- Janela/identidade desktop por jogo (opcional): `src/projects/<jogo>/desktop.json` (`productName`, `identifier`, `window`); o padrão é janela comum e segura.

## Não toque (a engine é genérica; um jogo não exige mudar nada disso)
`src/core`, `src/engine`, `src/plugins`, `src/contracts`, `src/tokens`, `src-tauri`, `.freeze-lock.json`, `agents.mjs`, `scripts/architecture`. Se faltar API, NÃO contorne: registre a lacuna ("falta X na capability Y") e siga com o que existe.

## Como acessar a engine
- Só por: `@core` (kernel), `src/tokens/*` (capabilities) e `src/contracts/*` (tipos/eventos/comandos/helpers). Nunca `src/engine/**/internal`, `src/core/internal`, `window.__*`, nem `game.debug`.
- Fluxo: declare o token em `manifest.capabilities.consumes` E `manifest.permissions.capabilities`, depois `ctx.caps.require(Token)`. Token que pode faltar (ex. `game.steam.net`): `optional: true` + `ctx.caps.get(Token)`.
- Ordem de boot: `manifest.dependsOn` com ids `game.*` (ex.: `game.render`, `game.physics`). Cada módulo diz seu id em `docs/ai/modules/<chave>.md`.
- Comunicar: eventos (`ctx.events.on/emit`) e comandos (`ctx.commands.send/handle`) com os tipos de `src/contracts`.
  - `permissions.events` é a allow-list EXATA do que o plugin EMITE: `[]` = não emite nada; omitir (preloaded) = sem restrição. Ouvir não exige declaração.
  - `commands.send` resolve com o RETORNO do handler (`undefined` sem handler) e rejeita se ele lançar; `commands.request` exige handler. Mesmo assim, para dados prefira os métodos dos tokens (síncronos e tipados).
  - `emit` entrega "em algum momento, na ordem" e por REFERÊNCIA: não mute o payload depois (ou `emit(t, p, { copy: true })`); `await emitAsync` roda os handlers agora.
  - Erros em handlers não voltam ao emissor: saem no evento `kernel.handler.error` (e viram crash report automático do `game.security`).
- O plugin do jogo só COMPÕE (pede capabilities, liga eventos, faz dispose). Lógica de jogo vai em classes da pasta, sem acessar o kernel direto, para ser testável com mocks.
- Three.js e DOM são permitidos nos adapters do jogo (a engine expõe `THREE.Scene` via render). Rapier NÃO: use só `PhysicsApi`.

## Ciclo de vida (erros mais comuns)
1. Sempre `ctx.lifecycle.ready()` no fim do `setup`.
2. Tudo que você adquire tem dispose em `ctx.lifecycle.onDispose` (ordem inversa): listeners (`on` devolve o unsubscribe), meshes (`removeMeshFromScene`, que já libera os recursos não compartilhados), corpos (`removeBody`), agentes, emissores, sprites, assets (`releaseAsset`), nós de DOM.
3. Simulação no `game.loop.tick` (passo fixo, `deltaSeconds`; física, IA e scripting já avançam nesse tick). Visual no `game.loop.render` (desenhado depois dos handlers; interpolação opcional em `RenderApi.setInterpolated`).
4. Pausa (`GameLoopApi.pause()`): para os ticks, o render continua (`isPaused`, delta 0). A tecla de "continuar" vai no evento `game.input.action`, não no tick.
5. Sem alocação por tick/frame (reuse objetos). Payloads de tick/render e alguns getters são reutilizados: copie com `copyTickPayload`/`copyRenderPayload`/`copyEntitySnapshot`/`copyViewportDimensions`.
6. Não dependa de Steam: sem ela nada lança; métodos de `game.steam`/`game.steam.net` resolvem `false`/`null`/`[]`. Teste `await steam.checkAvailability()` antes de mostrar recursos Steam.
7. NÃO chame `update()`/`step()` de módulos: a engine já atualiza (tabela abaixo).
8. Bordas de input no tick: `isActionPressedInTick`/`isActionReleasedInTick`; contínuos: `getAxis`/`isActionHeld`.

## HUD, texto, estado
- HUD: contêiner `#hud-overlay` (não bloqueia cliques no canvas); `data-bind="chave"` (texto) e `data-hud-fill="chave"` (barra = chave/`max<Chave>`); valor via `ui.bindHUDData({...})`/`ui.updateHUD(k, v)`. As chaves são suas.
- A UI da engine NÃO captura ESC nem `[data-action]`: o jogo decide pausa/menus. Botões em modais/telas: `data-ui-action` ⇒ evento `game.ui.action`. Texto de jogador/rede: `contentText` (HTML é sanitizado, mas não confie).
- Save: `storage.configureSaves({ namespace: "<jogo>", schemaVersion })` no boot; `saveGame(slot, dados)`; leia com `loadGameDetailed` (não rejeita). Só dados serializáveis.

## Validar (obrigatório antes de dizer "pronto")
```
npm run arch:check && npx tsc --noEmit && npx vitest run && npm run build
npm run ai-manual:check      # manual em sincronia com o código
npm run project:isolation    # engine continua verde sem os jogos
```
Testes do jogo ficam DENTRO da pasta do jogo (`src/projects/<jogo>/*.test.ts`), com fakes parciais das APIs dos tokens (receita 11). Nunca desative guardrails nem mexa em baselines para obter verde.

## MCP da engine (se o seu cliente tiver)
Servidor MCP `engine` (`.mcp.json`, `npm run mcp`; guia em `docs/mcp/README.md`): manual (`docs_read`, `module_api`, `gaps_list`), criar/checar jogo (`project_create`, `project_check`), gates (`gate_run`), jogo rodando (`runtime_launch` → `kernel_inspect`, `world_*`, `screenshot`, `logs_tail`), cenas JSON (`scene_*`, `prefab_*`, `assets_validate`) e build/Steam (`build_*`, `steam_*`). Ele só escreve em `src/projects/<jogo>/`, `docs/games/<jogo>/` e `src-tauri/gen/`; as regras acima continuam valendo.

## Quem atualiza o quê (verificado nos plugins)
| módulo | a engine chama sozinha | o jogo precisa |
|---|---|---|
| physics | `step` no tick | criar/remover corpos; mover kinematic com `setNextKinematicTransform` |
| input | pump por requestAnimationFrame + snapshot por tick | ler no tick (`*InTick`, eixos) ou no render |
| camera | escreve a câmera ativa no render (só se houver câmera virtual) | registrar câmera; alvo por `followTargetId` ou `setFollowTarget` |
| anim, vfx, sprites | tick/render (pausado não avança) | registrar/parar o que criou |
| ai, scripting, world, security | `update`/índices no tick (security também no render) | ai: navmesh + alvos; scripting: zonas (automáticas por tag/`trackEntity` ou `checkEntityInZones`) |
| streaming | `update` no tick com o centro (câmera por padrão) | registrar setores e reagir a `sector-loaded/unloaded` |
| terrain | `update` no tick: streaming (se ligado), colliders, malhas | ligar streaming OU `requestChunk`/`unloadChunk` |
| net | pump da sessão (tick/render), heartbeat, snapshot automático se ligado | host/connect, mensagens do jogo |
| steam | pump de eventos nativos | — |
| security | captura automática de erros e frames | métricas dos seus sistemas |

## Limitações conhecidas
Antes de planejar, leia `docs/ai/GAPS.md`: lista curta do que ainda falta (host WebSocket só no app nativo e sem TLS, sem WebRTC, publicar no Workshop só nativo, compra real só com servidor do jogo…) e o que não foi verificado com Steam/Tauri reais.

## Mapa do manual
- `docs/ai/INDEX.md` — qual módulo para qual necessidade, com tamanhos.
- `docs/ai/CORE.md` — contrato do plugin e do `PluginContext`.
- `docs/ai/modules/*.md` — API pública de cada módulo (token + tipos + eventos + comandos + notas).
- `docs/ai/RECIPES.md` — trechos que compilam (fonte: `src/projects/_template/recipes/`).
- `docs/ai/GAPS.md` — lacunas abertas e contornos.
- `docs/mcp/README.md` — servidor MCP da engine (ferramentas para IA).

## Ordem de boot do kernel (verificado em src/core/runtime/boot.ts)
1. `setup(ctx)` de todos os plugins, em ordem topológica de `dependsOn` (dependências primeiro).
2. Resolução de capabilities → espera de `lifecycle.ready()` → `kernel.plugin.started` + `onBoot` de cada plugin (se existir) → evento `kernel.booted` (aí o game-loop começa).
3. Use `setup` para registrar capabilities/handlers/listeners; use `onBoot` para o que precisa de todos os plugins já prontos. Plugin cujo `setup`/`onBoot` falha é colocado em quarentena (modo tolerante) e `onBoot` falho recebe `onStop`.
4. Desligamento em ordem inversa; registre limpeza com `ctx.lifecycle.onDispose(fn)` (a engine libera só os próprios recursos; corpos, listeners e meshes do JOGO são responsabilidade do jogo).
