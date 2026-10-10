# Regras para IA — criar jogos sobre esta engine (leia inteiro; é curto)

## Onde escrever
- Todo código de jogo fica em `src/projects/<jogo>/`. É a ÚNICA pasta que você cria/edita para um jogo.
- Comece copiando `src/projects/_template/` (a pasta `_template` e qualquer pasta `_*` nunca é carregada).
- `index.ts` exporta `project: ProjectDefinition` ({id, name, createPlugins}). O jogo é descoberto sozinho; apagar a pasta remove o jogo.
- Vários jogos: `VITE_PROJECT=<id>` é OBRIGATÓRIO para `dev`/`tauri` (com 2+ jogos e sem a variável o app lança erro no boot; `npm run build` compila igual). Um só: é o ativo. Em testes do jogo use `createProjectPlugins("<id>")` explícito, nunca sem argumento. Assets em `public/projects/<jogo>/...` (URL `/projects/<jogo>/...`).

## Não toque (a engine é genérica; um jogo não exige mudar nada disso)
`src/core`, `src/engine`, `src/plugins`, `src/contracts`, `src/tokens`, `src-tauri`, `.freeze-lock.json`, `agents.mjs`, `scripts/architecture`. Se faltar API, NÃO contorne: registre a lacuna ("falta X na capability Y") e siga com o que existe.

## Como acessar a engine
- Só por: `@core` (kernel), `src/tokens/*` (capabilities) e `src/contracts/*` (tipos/eventos/comandos). Nunca `src/engine/**/internal`, `src/core/internal`, `window.__*`, nem `game.debug`.
- Fluxo: declare o token em `manifest.capabilities.consumes` E `manifest.permissions.capabilities`, depois `ctx.caps.require(Token)`.
- Ordem de boot: `manifest.dependsOn` com ids `game.*` (ex.: `game.render`, `game.physics`). Cada módulo diz seu id em `docs/ai/modules/<chave>.md`.
- Comunicar: eventos (`ctx.events.on/emit`) e comandos (`ctx.commands.send/handle`) com os tipos de `src/contracts`. Emitir um evento exige declará-lo em `permissions.events`. Comandos NÃO devolvem resultado (G29) e eventos são entregues depois, por referência (G122): para obter dados use os métodos dos tokens.
- O plugin do jogo só COMPÕE (pede capabilities, liga eventos, faz dispose). Lógica de jogo vai em classes da pasta, sem acessar o kernel direto, para ser testável com mocks.
- Three.js e DOM são permitidos nos adapters do jogo (a engine expõe `THREE.Scene` via render). Rapier NÃO: use só `PhysicsApi`.

## Ciclo de vida (erros mais comuns)
1. Sempre `ctx.lifecycle.ready()` no fim do `setup`.
2. Tudo que você adquire tem dispose registrado em `ctx.lifecycle.onDispose` (ordem inversa): listeners (`on` devolve o unsubscribe), meshes (`removeMeshFromScene`, que já libera geometria/material dos `Mesh`), corpos (`removeBody`), assets (`releaseAsset`), nós de DOM.
3. Lógica de simulação no evento `game.loop.tick` (passo fixo, `deltaSeconds`); a física já avança sozinha nesse tick. Apresentação/render usa interpolação.
4. Sem alocação por tick/frame (reuse objetos).
5. Não dependa de Steam: sem Steam tudo continua funcionando (`commands.send` devolve `Promise<void>`; métodos do `SteamApi` resolvem `false`/`null`).
6. NÃO chame `update()`/`step()` de módulos: a engine já atualiza no tick/render (tabela abaixo). Exceção: o jogo decide os chunks do terreno (`requestChunk`/`unloadChunk`) e checa zonas (`checkEntityInZones`).
7. Ações de toque único: escute `game.input.action` (o input é bombeado por frame, não por tick).

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

## Quem atualiza o quê (verificado nos plugins)
| módulo | a engine chama sozinha | o jogo precisa |
|---|---|---|
| physics | `step` no tick | criar/remover corpos, chão (terreno não tem colisor) |
| input | `update` por requestAnimationFrame | ler eixos no tick; bordas pelo evento `game.input.action` |
| camera | aplica a câmera virtual ativa no render (sobrescreve a câmera do render) | registrar câmera, `setFollowTarget` a cada tick |
| anim, vfx | tick/render | registrar/parar o que criou |
| ai, scripting, security, world | `update`/índices no tick | ai: navmesh + alvos; scripting: `checkEntityInZones` |
| streaming | `update` no tick com a posição da câmera | registrar setores e reagir a `sector-loaded/unloaded` |
| terrain | `update` no tick é NO-OP | `requestChunk`/`unloadChunk` |
| net | só `pollPackets` no tick | gerar/serializar/enviar snapshots |

## Limitações conhecidas
Antes de planejar um jogo, leia `docs/ai/GAPS.md` (auditoria completa: ~130 lacunas/bugs por módulo, com contorno). Alguns módulos estão QUEBRADOS hoje: sprites (cena), partículas de vfx, `game.steam.net`, compras, Workshop e execução de mods.

## Mapa do manual
- `docs/ai/INDEX.md` — qual módulo para qual necessidade, com tamanhos.
- `docs/ai/CORE.md` — contrato do plugin e do `PluginContext`.
- `docs/ai/modules/*.md` — API pública de cada módulo (token + tipos + eventos + comandos).
- `docs/ai/RECIPES.md` — trechos que compilam (fonte: `src/projects/_template/recipes/`).
- `docs/ai/GAPS.md` — lacunas da engine e contornos aprovados.

## Ordem de boot do kernel (verificado em src/core/runtime/boot.ts)
1. `setup(ctx)` de todos os plugins, em ordem topológica de `dependsOn` (dependências primeiro).
2. Resolução de capabilities → espera de `lifecycle.ready()` → `kernel.plugin.started` + `onBoot` de cada plugin (se existir) → evento `kernel.booted` (aí o game-loop começa).
3. Use `setup` para registrar capabilities/handlers/listeners; use `onBoot` para o que precisa de todos os plugins já prontos. Plugin cujo `setup`/`onBoot` falha é colocado em quarentena (modo tolerante) e `onBoot` falho recebe `onStop`.
4. Desligamento em ordem inversa; registre limpeza com `ctx.lifecycle.onDispose(fn)` (a engine libera só os próprios recursos, ex. física e render nos seus plugins; corpos, listeners e meshes do JOGO são responsabilidade do jogo).
