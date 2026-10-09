# Regras para IA — criar jogos sobre esta engine (leia inteiro; é curto)

## Onde escrever
- Todo código de jogo fica em `src/projects/<jogo>/`. É a ÚNICA pasta que você cria/edita para um jogo.
- Comece copiando `src/projects/_template/` (a pasta `_template` e qualquer pasta `_*` nunca é carregada).
- `index.ts` exporta `project: ProjectDefinition` ({id, name, createPlugins}). O jogo é descoberto sozinho; apagar a pasta remove o jogo.
- Vários jogos: `VITE_PROJECT=<id>`; um só: é o ativo. Assets em `public/projects/<jogo>/...` (URL `/projects/<jogo>/...`).

## Não toque (a engine é genérica; um jogo não exige mudar nada disso)
`src/core`, `src/engine`, `src/plugins`, `src/contracts`, `src/tokens`, `src-tauri`, `.freeze-lock.json`, `agents.mjs`, `scripts/architecture`. Se faltar API, NÃO contorne: registre a lacuna ("falta X na capability Y") e siga com o que existe.

## Como acessar a engine
- Só por: `@core` (kernel), `src/tokens/*` (capabilities) e `src/contracts/*` (tipos/eventos/comandos). Nunca `src/engine/**/internal`, `src/core/internal`, `window.__*`, nem `game.debug`.
- Fluxo: declare o token em `manifest.capabilities.consumes` E `manifest.permissions.capabilities`, depois `ctx.caps.require(Token)`.
- Ordem de boot: `manifest.dependsOn` com ids `game.*` (ex.: `game.render`, `game.physics`). Cada módulo diz seu id em `docs/ai/modules/<chave>.md`.
- Comunicar: eventos (`ctx.events.on/emit`) e comandos (`ctx.commands.send/handle`) com os tipos de `src/contracts`. Emitir um evento exige declará-lo em `permissions.events`.
- O plugin do jogo só COMPÕE (pede capabilities, liga eventos, faz dispose). Lógica de jogo vai em classes da pasta, sem acessar o kernel direto, para ser testável com mocks.
- Three.js e DOM são permitidos nos adapters do jogo (a engine expõe `THREE.Scene` via render). Rapier NÃO: use só `PhysicsApi`.

## Ciclo de vida (erros mais comuns)
1. Sempre `ctx.lifecycle.ready()` no fim do `setup`.
2. Tudo que você adquire tem dispose registrado em `ctx.lifecycle.onDispose` (ordem inversa): listeners (`on` devolve o unsubscribe), meshes (`removeMeshFromScene` + dispose de geometry/material), corpos (`removeBody`), assets (`releaseAsset`), nós de DOM.
3. Lógica de simulação no evento `game.loop.tick` (passo fixo, `deltaSeconds`); a física já avança sozinha nesse tick. Apresentação/render usa interpolação.
4. Sem alocação por tick/frame (reuse objetos).
5. Não dependa de Steam: sem Steam tudo continua funcionando (comandos Steam resolvem como `false`).

## HUD, texto, estado
- HUD: contêiner `#hud-overlay`; `data-bind="chave"` (texto) e `data-hud-fill="chave"` (barra = chave/`max<Chave>`); valor via `ui.bindHUDData({...})`/`ui.updateHUD(k, v)`. As chaves são suas.
- Save: `StorageApi.saveGame(slot, dados)`; só dados serializáveis.

## Validar (obrigatório antes de dizer "pronto")
```
npm run arch:check && npx tsc --noEmit && npx vitest run && npm run build
npm run ai-manual:check      # manual em sincronia com o código
npm run project:isolation    # engine continua verde sem os jogos
```
Testes do jogo ficam DENTRO da pasta do jogo (`src/projects/<jogo>/*.test.ts`), com mocks das APIs dos tokens. Nunca desative guardrails nem mexa em baselines para obter verde.

## Mapa do manual
- `docs/ai/INDEX.md` — qual módulo para qual necessidade, com tamanhos.
- `docs/ai/CORE.md` — contrato do plugin e do `PluginContext`.
- `docs/ai/modules/*.md` — API pública de cada módulo (token + tipos + eventos + comandos).
- `docs/ai/RECIPES.md` — trechos que compilam (fonte: `src/projects/_template/recipes/`).

## Ordem de boot do kernel (verificado em src/core/runtime/boot.ts)
1. `setup(ctx)` de todos os plugins, em ordem topológica de `dependsOn` (dependências primeiro).
2. Resolução de capabilities → espera de `lifecycle.ready()` → `kernel.plugin.started` + `onBoot` de cada plugin (se existir) → evento `kernel.booted` (aí o game-loop começa).
3. Use `setup` para registrar capabilities/handlers/listeners; use `onBoot` para o que precisa de todos os plugins já prontos. Plugin cujo `setup`/`onBoot` falha é colocado em quarentena (modo tolerante) e `onBoot` falho recebe `onStop`.
4. Desligamento em ordem inversa; registre limpeza com `ctx.lifecycle.onDispose(fn)` (a engine libera só os próprios recursos, ex. física e render nos seus plugins; corpos, listeners e meshes do JOGO são responsabilidade do jogo).
