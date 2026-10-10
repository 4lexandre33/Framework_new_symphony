# SPEC — Trem Fora de Controle (mini-jogo de validação da engine)

Versão 1.0 · escrita para execução por IA (Claude Sonnet) · fonte de design: `docs/games/trem-fora-de-controle/GDD.md`

Este documento é a ORDEM DE SERVIÇO. O GDD é a visão completa; esta SPEC recorta um **vertical slice** (GDD §35 MVP) e define, sem ambiguidade, o que construir, onde, com quais APIs, com quais números e como provar que funciona. Quando a SPEC e o GDD divergirem, **vale a SPEC**.

---

## 0. Como executar esta SPEC (leia antes de tudo)

### 0.1 Leitura obrigatória, nesta ordem
1. `docs/ai/INDEX.md` — mapa do manual.
2. `docs/ai/RULES.md` — regras (inclui a tabela "Quem atualiza o quê").
3. `docs/ai/GAPS.md` — o que a engine NÃO faz e o contorno aprovado (G1…G24). Esta SPEC já usa esses contornos.
4. `docs/ai/CORE.md` — contrato de plugin.
5. Cada `docs/ai/modules/<chave>.md` **no momento** da tarefa que usa o módulo (a tarefa diz qual).
6. `docs/ai/RECIPES.md` — trechos que compilam (10-camera, 12-input-edge-events, 13-terrain-chunks, 14-local-frame são a base deste jogo).

NÃO leia `src/engine/**`, `src/plugins/**` nem `src/core/**`. Se o manual não responder uma dúvida de comportamento, escreva um teste pequeno com mock ou registre a dúvida no `ENGINE_REPORT.md` (§12) e siga com a hipótese mais segura.

### 0.2 Regras de ouro (violar = tarefa reprovada)
1. **Só escreva em** `src/projects/trem/**` e `public/projects/trem/**`. Nada mais (nem `package.json`, nem `docs/ai`, nem engine). Exceção única: o `ENGINE_REPORT.md` fica dentro de `src/projects/trem/`.
2. **Apagar as duas pastas remove o jogo** e a engine continua verde (`npm run project:isolation`).
3. Acesso à engine **só** por `@core`, `src/tokens/*`, `src/contracts/*` (as "portas"). Nunca `engine/**/internal`, `window.__*`, `game.debug`.
4. Camadas do jogo (§3): `domain/` é TypeScript puro (sem Three, DOM, tokens, contracts, `@core`); só `adapters/` falam com a engine; o `TremPlugin.ts` só compõe.
5. Nada de `Math.random()` nem `Date.now()` em regra de jogo: use `domain/rng.ts` (seed) e o tempo do tick.
6. Sem alocação por tick/frame em caminhos quentes (reuse objetos, vetores de saída `out`).
7. Tudo que for criado tem dispose registrado (`ctx.lifecycle.onDispose`), em ordem inversa.
8. Não chame `update()`/`step()` de módulos da engine (a engine já chama). Exceções explícitas na tarefa.
9. Se uma API faltar: **não contorne mexendo na engine**. Use o contorno do `GAPS.md` ou registre nova lacuna no `ENGINE_REPORT.md` com reprodução mínima.
10. Toda tarefa termina com os gates da §0.4 verdes. Se algum falhar e você não souber corrigir sem violar as regras, pare e descreva o bloqueio no `ENGINE_REPORT.md`.

### 0.3 Convenções
- Id do projeto: `trem`. Plugin: `project.trem`. Pasta: `src/projects/trem/`. Assets: `public/projects/trem/` (URL `/projects/trem/...`).
- Rodar o jogo: `VITE_PROJECT=trem npm run dev` (navegador) ou `VITE_PROJECT=trem npm run tauri dev` (nativo). Com 2+ projetos em `src/projects/` (já existe `physics-sandbox`), SEM `VITE_PROJECT` o app lança erro no boot — isso é esperado. Nos testes, chame `createProjectPlugins("trem")` explicitamente.
- Idioma de UI e comentários: português do Brasil. Identificadores de código: inglês.
- Commits: um por tarefa, mensagem `trem: Txx <resumo>`.

- Risco conhecido (G24): os workflows de CI do Stage 88 rodam o app empacotado sem `VITE_PROJECT`; com o `trem` presente o boot lança erro. NÃO altere workflows; registre no `ENGINE_REPORT.md` se observar.

### 0.4 Gates (rodar ao fim de CADA tarefa)
```bash
npx tsc --noEmit
npx vitest run src/projects/trem --no-file-parallelism
npm run arch:check
```
Ao fim das tarefas marcadas **[MARCO]**, rode também:
```bash
npx vitest run --no-file-parallelism
npm run build
npm run ai-manual:check
npm run project:isolation
node agents.mjs
git diff --check
```

### 0.5 Definição de pronto de uma tarefa
- Todos os critérios de aceite da tarefa atendidos e cobertos por teste quando a tarefa pedir teste.
- Gates verdes.
- Nenhum arquivo fora das duas pastas alterado (`git status`).
- Linha atualizada na matriz do `ENGINE_REPORT.md` para cada capacidade que a tarefa tocou.

---

## 1. O que é o mini-jogo (escopo)

Uma expedição solo ou cooperativa de ~10 minutos. Uma locomotiva a vapor puxa dois vagões (oficina e tanque) por uma ferrovia gerada por seed sobre terreno voxel. Os jogadores andam DENTRO/SOBRE o trem em movimento, mantêm a caldeira (carvão + água), puxam recursos da beira dos trilhos com um gancho, consertam peças, fabricam itens, apagam incêndios, expulsam saqueadores e decidem rota e melhorias numa estação. Vitória: chegar ao fim com o malote. Derrota: locomotiva destruída/descarrilada, trem parado demais ou malote perdido.

### 1.1 Entra (do GDD)
| GDD | Item | Simplificação |
|---|---|---|
| §5 | Locomotiva com subsistemas e falhas encadeadas | 5 componentes + 2 engates + bancada; fórmulas da §5 desta SPEC |
| §6 | Vagões modulares, engates, desconexão, reengate | 2 vagões fixos (oficina, tanque) |
| §7 | Descarrilamento por velocidade/curva/rodas/clima | só locomotiva (grave) e último vagão (parcial) |
| §8 | WASD, E, Shift, Espaço, mouse, G, Tab, Q, roda, girar câmera | jogadores sempre no trem; queda = reaparece |
| §9 | Carvão, madeira, sucata, água; mão + depósitos | sem peso, 1 item na mão |
| §10 | Reparo emergencial/convencional/completo, 1 minigame (válvula), fabricação (4 receitas) | |
| §11–12 | Rota procedural por seed, estação, bifurcação A/B, biomas da engine | biomas = os 4 da engine |
| §13 | Destruição voxel | rocha nos trilhos (modelo do jogo) + bomba que remove ≤ 27 blocos de terreno |
| §14 | Clima | só "tempestade" |
| §15 | IA | 1 categoria: saqueador |
| §16 | Diretor de eventos | 8 eventos |
| §18 | Multiplayer host autoritativo | protocolo completo; validado por loopback; Steam só no app nativo |
| §19–20 | Câmera isométrica, HUD, alertas por nível, painel de rota (minimapa) no mundo | |
| §21–22 | Expedição padrão; progressão; 6 conquistas | sem outros modos |
| §23–24 | Áudio espacial + música dinâmica; VFX voxel | sons gerados por script |
| §25–26 | Mod de exemplo (override de asset); cosméticos com moeda do jogo | sem compra real |
| §29 | Orçamentos de desempenho | §11 desta SPEC |

### 1.2 Não entra
Outros modos (§21.2–21.6), mais biomas próprios, robôs auxiliares, espectador, replays, votação de rota, reconexão além do descrito em §8.6, Workshop real, compras reais, localização além de pt-BR, gamepad além do mapeamento básico.

### 1.3 Critérios de aprovação do slice (GDD §35.3 adaptado)
1. Trem anda estável pela rota; jogadores andam sobre vagões em movimento.
2. Coleta, depósito, abastecimento, reparo, fabricação funcionam.
3. Ao menos uma falha mecânica, uma desconexão de vagão (com reengate) e um evento externo acontecem numa partida com seed 1234 jogada pelo bot roteirizado da T09 (política definida lá) — provado por teste de simulação headless.
4. Sincronização host↔clientes provada por teste loopback (2 e 4 jogadores).
5. Partida termina corretamente em vitória e em cada derrota (testes).
6. Matriz de capacidades (§12) com as 23 capacidades + `game.steam.net` marcadas e evidência.

---

## 2. Decisões técnicas fixas (não reabra)

### 2.1 Referencial local do trem — "ilha" (contorno G1)
A engine não move corpos físicos fixos. Então **toda a física do trem e de quem está nele roda parada numa "ilha"** longe da rota, e o desenho aplica a pose de cada vagão no mundo.
- `ISLAND = { x: -5000, y: -500, z: -5000 }` (longe em X/Z porque `world.querySpatialGrid` é 2D).
- Na ilha, os carros ficam alinhados no eixo local +Z (frente = +Z), piso do vagão com topo em `y_local = 1.0`.
- Slot de cada carro na ilha (centro, em coordenadas locais relativas a `ISLAND`): carro `i` em `z = -i * 11.5` (loco i=0, oficina i=1, tanque i=2).
- Conversão ilha→mundo por carro (receita 14, que já subtrai `ISLAND`): para um ponto em coordenadas ABSOLUTAS da ilha `p` dentro do carro `i`, chame `islandToWorld({ x: p.x, y: p.y, z: p.z + 11.5·i }, pose_i, out)` (o `+11.5·i` leva o slot do carro para a origem do carro). Cada carro tem a SUA pose (vagão desacoplado diverge).
- Forças fictícias (curva/frenagem) são aplicadas a todos os corpos dinâmicos da ilha (§5.6).

### 2.2 Unidades e eixos
- 1 unidade = 1 bloco voxel = 1 m. Y para cima. Rota parte de (0, h, 0) rumo a +Z.
- `yaw` = rotação em torno de Y, 0 = olhando +Z, positivo gira de +Z para +X (mesma convenção de `islandToWorld`).
- Tick fixo 60 Hz (padrão da engine). Use `deltaSeconds` do tick, nunca assuma 1/60.

### 2.3 Aleatoriedade
- `domain/rng.ts`: `mulberry32(seed: number)` → `{ next(): number /*[0,1)*/, int(min,max), pick(arr), fork(salt): Rng }`.
- Fluxos separados por `fork(salt)`: `ROUTE=1, ROUTE_A=2, ROUTE_B=3, DECOR=4, DIRECTOR=5, RAIDERS=6, LOOT=7`.
- Seed padrão de teste: `1234`. Seed da partida: escolhida no lobby. O adapter de lobby (`Menus.ts`) pode usar `Date` só para SUGERIR a seed (dia do ano × 7919 + 17); a simulação recebe a seed pronta e nunca lê relógio.

### 2.4 Voxel
- Modelos do jogo são DADOS (`content/models.ts`): `{ size:[w,h,d], palette: string[], voxels: [x,y,z,colorIdx][] }`, escala 0,25 m por voxel para personagens/itens e 0,5 m para trem/decoração (campo `scale` no modelo).
- `adapters/VoxelMesher.ts` converte em `THREE.BufferGeometry` com cores por vértice, eliminando faces internas; materiais `MeshLambertMaterial({ vertexColors: true })` compartilhados (1 por modelo); geometria em cache por id de modelo.
- Repetidos (dormentes, trilhos, árvores, rochas, montes de recurso) usam `THREE.InstancedMesh` por setor.
- Terreno: o da engine (`game.terrain`), cor única (G3). Cor por bioma fica nas decorações.

### 2.5 Câmera
Isométrica via `game.camera` (G4): receita 10. `yaw ∈ {45°,135°,225°,315°}`, pitch −35°, braço 25–70 (padrão 42), fov 35. Segue o jogador local (ou a locomotiva, tecla C). Zoom pela roda (listener DOM, G5). Girar: tecla R (re-registro). Shake: `addTrauma`, multiplicado pela opção de acessibilidade.

### 2.6 Rede
Host autoritativo. A simulação inteira roda no host; clientes enviam input e desenham snapshots interpolados. Porta `NetTransportPort` (§8). Sem Steam (navegador), só solo; o multiplayer é validado por transporte loopback em teste (G8).

### 2.7 Áudio e assets
Todos os sons e texturas são **gerados** por `src/projects/trem/tools/gen-assets.mjs` (Node puro, sem dependências novas) e versionados em `public/projects/trem/`. Toda URL de asset passa pelo `AssetResolver` (mod override, §7.11).

---

## 3. Arquitetura do jogo

### 3.1 Árvore de pastas (crie exatamente isto)
```
src/projects/trem/
  index.ts                     ProjectDefinition { id:"trem", name:"Trem Fora de Controle" }
  TremPlugin.ts                plugin de COMPOSIÇÃO (manifest + wiring + dispose)
  ENGINE_REPORT.md             relatório final (§12)
  config/
    balance.ts                 TODOS os números das §4–§6 (constantes nomeadas)
    content.ts                 receitas, eventos, quests, diálogos, conquistas, cosméticos, textos
    models.ts                  modelos voxel (dados)
  domain/                      PURO. Importa só domain/ e config/
    rng.ts  math.ts  bus.ts  types.ts
    ports/                     interfaces que o domínio usa (tipos do jogo; implementadas em adapters/)
      PhysicsIslandPort.ts  NavPort.ts  WorldIndexPort.ts  TerrainPort.ts
      PresentationPort.ts (visual+áudio+vfx)  HudPort.ts  NetTransportPort.ts
      PersistencePort.ts  PlatformPort.ts (steam)  ProfilerPort.ts  QuestPort.ts
    rail/RailPath.ts  rail/ElevationProfile.ts
    train/Locomotive.ts  train/Consist.ts  train/Components.ts  train/Derailment.ts
    survival/Inventory.ts  survival/Crafting.ts  survival/Fire.ts  survival/Repair.ts
    player/PlayerState.ts  player/Interaction.ts
    encounter/EventDirector.ts  encounter/Weather.ts  encounter/RaiderBrain.ts  encounter/Obstacles.ts
    session/MatchState.ts  session/Score.ts  session/Progression.ts  session/Achievements.ts
    net/Protocol.ts  net/HostSession.ts  net/ClientSession.ts
    Simulation.ts              orquestra os sistemas por tick (sem engine)
  adapters/                    ÚNICO lugar que importa tokens/contracts/three/DOM
    AssetResolver.ts  VoxelMesher.ts
    PhysicsIslandAdapter.ts    (PhysicsApi)
    WorldIndexAdapter.ts       (WorldApi)
    TerrainAdapter.ts          (TerrainApi)
    StreamingAdapter.ts        (StreamingApi + comando set-radius)
    TrainView.ts  CharacterView.ts  DecorView.ts  SunLight.ts   (RenderApi)
    CameraRig.ts               (CameraApi + wheel DOM)
    InputAdapter.ts            (InputApi + game.input.action)
    AnimAdapter.ts             (AnimationApi)
    AudioAdapter.ts            (AssetsApi + AudioApi)
    VfxAdapter.ts              (VfxApi + AssetsApi)
    NavAdapter.ts              (AiApi)
    QuestAdapter.ts            (ScriptingApi)
    HudView.ts  Menus.ts  ValveMinigame.ts   (UIApi + DOM)
    RoutePanel.ts              (SpritesApi + AssetsApi)
    NetAdapter.ts              (NetworkApi + SteamNetworkApi)
    SaveAdapter.ts             (StorageApi + MonetizationApi + SecurityApi)
    SteamAdapter.ts            (SteamApi + UnlockAchievementCommand)
    ModAdapter.ts              (ModdingApi)
    OverlayAdapter.ts          (OverlayApi)
    SecurityAdapter.ts         (SecurityApi + error listeners + profiler)
    LoopAdapter.ts             (GameLoopApi + game.loop.tick/render)
    DebugPanel.ts              (F3)
  testing/                     dublês para testes (não importados pelo jogo em produção)
    fakes.ts                   fakes de PhysicsApi, AiApi, WorldApi, StorageApi… (receita 11)
    LoopbackHub.ts             transporte em memória para N peers
  tools/
    gen-assets.mjs
  *.test.ts                    testes ao lado do código (domain/*.test.ts, adapters/*.test.ts)
public/projects/trem/
  audio/*.wav  textures/*.png  atlas/icons.png  atlas/icons.json  mods/demo/apito-alt.wav
```

### 3.2 Regras de dependência (testadas em T02)
- `domain/**` (inclui `domain/ports/`) → só `domain/**`, `config/**`.
- `adapters/**` → `domain/**`, `config/**`, `src/tokens/*`, `src/contracts/*`, `@core` (tipos), `three`, DOM.
- `TremPlugin.ts` → tudo acima. Nada importa `TremPlugin.ts` exceto `index.ts`.
- Teste `architecture.test.ts` lê os arquivos com `fs` e falha se `domain/` importar algo proibido (`three`, `/tokens/`, `/contracts/`, `@core`, `document`, `window`).

### 3.3 Barramento interno do jogo
`domain/bus.ts`: barramento tipado síncrono, sem alocação por emissão (lista fixa de handlers por tipo). Eventos de domínio (exemplos): `ComponentDamaged`, `ComponentRepaired`, `CouplingBroke`, `CarRecoupled`, `DerailStateChanged`, `FireStarted`, `FireOut`, `ItemCollected`, `ItemCrafted`, `RaiderSpawned`, `RaiderRepelled`, `CrateStolen`, `EventStarted`, `EventEnded`, `PhaseChanged`, `MatchEnded`, `PlayerFell`, `PlayerRespawned`, `QuickMessage`, `Alert`. A apresentação (adapters) assina esse barramento. **O jogo não emite eventos no barramento do kernel** (por isso `permissions.events: []`, G21).

### 3.4 Plugin de composição (`TremPlugin.ts`)
- `manifest.id = "project.trem"`, `kind: "preloaded"`, `authority: "game"`, `version: "0.1.0"`.
- `dependsOn`: os 23 ids `game.*` com `range: "^1.0.0"` (game.loop, game.render, game.physics, game.input, game.assets, game.storage, game.world, game.ui, game.anim, game.sprites, game.audio, game.camera, game.ai, game.vfx, game.terrain, game.scripting, game.streaming, game.overlay, game.security, game.modding, game.monetization, game.net, game.steam).
- `capabilities.consumes`: os 24 tokens (os 23 + `SteamNetworkToken` = `game.steam.net`), todos `optional: false`, e `permissions.capabilities` com os mesmos 24 ids. `permissions.events: []`.
- `setup(ctx)`: (1) `require` de todos os tokens; (2) cria adapters; (3) cria `Simulation`/sessão em estado `Lobby`; (4) assina tick/render pelo `LoopAdapter`; (5) registra cada dispose; (6) `ctx.lifecycle.ready()`.
- Carregamento assíncrono (sons, texturas) acontece em `onBoot`/depois do `ready()`, mostrando "Carregando…" no HUD; nunca bloqueie o `setup`.

---

## 4. Mundo, rota e terreno

### 4.1 RailPath (domain/rail/RailPath.ts)
- Nós a cada `NODE_SPACING = 8` unidades de arco. Nó 0 em (0,0,0), `yaw = 0`.
- Trecho comum: 120 nós (s = 0…960). Trechos de 6 nós escolhem curvatura `k` (rad/unidade) de `[-0.02,-0.01,0,0,0.01,0.02]` (fluxo `ROUTE`); `yaw_{n+1} = yaw_n + k·8`; `|yaw| ≤ 60°` (se passar, k = 0 naquele trecho).
- Estação: nós 92–108 forçados com `k = 0`; estação centrada em s = 800, plataforma de 40 unidades.
- Bifurcação no nó 120 (s = 960). Ramo A (fluxo `ROUTE_A`): +60 nós (fim s = 1440), mais rochas. Ramo B (`ROUTE_B`): +100 nós (fim s = 1760), carvão ×2. Os dois são gerados no início (determinísticos), só o escolhido recebe setores/decoração. Sem escolha até s = 940 → ramo A.
- API: `poseAt(s, out: {x,z,yaw})` (o y vem do ElevationProfile, só no adapter), `curvatureAt(s)`, `length()`, `nodeCount()`, `nodeXZ(i, out)`, `chooseBranch('A'|'B')`, `stationS`, `forkS`, `endS`.
- Teste: mesma seed ⇒ mesmos nós (snapshot de 10 nós); seeds diferentes ⇒ rotas diferentes; `|yaw| ≤ 60°` sempre; poseAt contínua.

### 4.2 ElevationProfile (domain/rail/ElevationProfile.ts)
- `setSurface(nodeIndex, h)` recebe a altura do terreno no nó (do TerrainAdapter, após `chunk-generated`).
- Altura do trilho `y_i = clamp(h_i + 2, y_{i-1} − 0.6, y_{i-1} + 0.6)` (rampa ≤ 7,5%), calculada em ordem; nó sem altura conhecida usa `y_{i-1}`. Nó 0 sem altura: 30.
- `freeze(i)`: chamado quando a locomotiva fica a < 24 unidades do nó; depois disso o valor não muda (se a altura chegar tarde, registre "elevação congelada sem amostra" uma vez no log de debug).
- `gradeAt(s)` = Δy/Δs do segmento — **só apresentação**. A simulação NÃO usa rampa: o perfil depende de quando os chunks chegam e quebraria o determinismo e a sincronia de rede. Cada máquina (host e clientes) calcula o seu `ElevationProfile` a partir do terreno da mesma seed.
- Aceite: o trem pode atravessar morros visualmente (terreno sem colisor e sem escavação, G3/G18). Registre no ENGINE_REPORT a frequência observada.

### 4.3 Terreno (adapters/TerrainAdapter.ts) — módulo `terrain`
- `terrain.setSeed(seed)` no início da partida.
- Chunks seguem uma JANELA da locomotiva (não os eventos de streaming): setores `k−1 … k+3` (k = setor da loco), corredor ±16 unidades em torno dos nós desses setores. Ao mudar de setor, `requestChunk({x,y:0,z})` dos que entraram e `unloadChunk` dos que saíram (≈ 60 chunks no máximo, §11). Os eventos de streaming cuidam de decoração, recursos e LOD (§4.4).
- No `game.terrain.chunk-generated`, para cada nó da rota dentro do chunk: `surfaceHeight` (receita 13) → `ElevationProfile.setSurface`.
- Bioma do nó: `getBiomeAt({x, y:0, z})` → guarda `biomeId` por nó (usado pela decoração e pelo diretor: deserto aumenta calor, §5.3).
- Destruição de terreno (bomba, §6.5): fila de no máximo 8 `modifyVoxelBlock({worldPosition, newBlockId: 0})` por tick (G18).
- Dispose: `terrain.clear()`.

### 4.4 Streaming (adapters/StreamingAdapter.ts) — módulo `streaming`
- Setor = 8 nós (64 unidades). `registerSector({ sectorCoord:{x:k,y:0,z:0}, boundsMin, boundsMax, assetUrls: [] })` com bounds = AABB dos nós ± 40 em X/Z e y absoluto de −50 a +250 (cobre as alturas de todos os biomas).
- Raio: `ctx.commands.send("game.streaming.set-radius", { loadRadius: 170, hysteresisMargin: 30 })` (a câmera fica alta; G17).
- `game.streaming.sector-loaded` → DecorView cria decoração do setor + recursos do setor entram no WorldIndex. `sector-unloaded` → desfaz.
- LOD: cada árvore registrada com `registerLODEntity({ entityId, worldPosition, lodLevels:[{level:0,distanceThreshold:0,meshUrl:"tree-full"},{level:1,distanceThreshold:60,meshUrl:"tree-low"}], currentLevel:0 })`; no `game.streaming.lod-changed` o DecorView troca a instância entre os InstancedMesh "full" e "low". `unregisterLODEntity` no unload.

### 4.5 Decoração e recursos (domain/encounter/Obstacles.ts + adapters/DecorView.ts)
Por setor (fluxo `DECOR` + índice do setor, determinístico):
| Item | Quantidade/setor | Posição | Modelo |
|---|---|---|---|
| Dormentes + trilhos | 64 dormentes | ao longo dos nós | `tie`, `rail` |
| Árvores (floresta/tundra) | 10–18 | lateral 6–30 | `tree_full`/`tree_low` (cor por bioma) |
| Rochas decorativas (deserto/montanha) | 6–12 | lateral 6–30 | `rock` |
| Monte de carvão (recurso) | 1–2 (×2 no ramo B) | lateral 4–9 | `coal_pile` (3 puxadas) |
| Árvore cortável (recurso madeira) | 1–2 | lateral 4–9 | `tree_full` (3 puxadas) |
| Sucata (recurso) | 0–2 | lateral 4–9 | `wreck` (2 puxadas) |
| Barril d'água (recurso) | 1 (deserto 0–1) | lateral 4–9 | `barrel` (1 puxada) |
Recursos entram no WorldIndex como entidades `res:<setor>:<n>` (tipo `resource`, tags `[coal|wood|scrap|water]`). As puxadas restantes ficam no ESTADO DO JOGO (mapa id→restantes), porque entidades do `world` são imutáveis; ao chegar a 0: `despawnEntity` + some a instância.

---

## 5. O trem (regras e números) — `config/balance.ts`

### 5.1 Carros
| i | Carro | Comprimento | Massa base | Conteúdo na ilha |
|---|---|---|---|---|
| 0 | Locomotiva | 10 | 40 | cabine (alavanca +, alavanca −, freio de emergência, painel de rota, **malote**), fornalha, caldeira, motor, rodas*, freios*, depósito de carvão (tender, 20) |
| 1 | Vagão-oficina | 10 | 20 + 0,5/unidade estocada | bancada, depósitos carvão(40)/madeira(30)/sucata(30), 3 caixas |
| 2 | Vagão-tanque | 10 | 15 + 0,1·água | tanque (100), torneira (encher balde; depositar barril) |
\* rodas e freios são componentes sem colisor próprio (interagir no truque da loco, lateral).
Espaço entre carros: 1,5 (passarela). Saliências de abordagem (ledges): 1 de cada lado das portas laterais da oficina e do tanque.

Estado inicial: carvão tender 10, oficina 10 carvão / 5 madeira / 6 sucata, água 80, todas integridades 100, alavanca 0, combustível da fornalha 30, temperatura 60 °C.

### 5.2 Componentes (domain/train/Components.ts)
Integridade 0–100 cada: `motor, caldeira, tanque, rodas, freios, engate1 (loco↔oficina), engate2 (oficina↔tanque), bancada`.
| Componente | Efeito da integridade |
|---|---|
| motor | potência × integridade/100 |
| caldeira | pressão = 0 se 0; dano por superaquecimento |
| tanque | resfriamento × integridade/100; vazamento se < 50 |
| rodas | fator de descarrilamento `w = 0,6 + 0,4·rodas/100`; desgaste |
| freios | eficiência de frenagem `b = 0,3 + 0,7·freios/100` |
| engate1/2 | rompe em 0 (§5.5) |
| bancada | fabricação 2× mais lenta se < 40; impossível se 0 |
Derrota "destruição crítica": `motor = 0` E `caldeira = 0`.

### 5.3 Locomotiva — termodinâmica (domain/train/Locomotive.ts), por tick com `dt`
- Alavanca `L ∈ {-1,0,1,2,3,4}` → velocidade alvo `[-1.5, 0, 1.5, 3, 4.5, 6]`. `L⁺ = max(L,0)`.
- Combustível da fornalha `F` (0–100): queima `(0.15 + 0.12·L⁺)·(tempestade?1.2:1)` por s se F>0. Pá de carvão: +20; madeira: +12.
- Calor `H = F>0 ? 5 + 3.0·L⁺ + (bioma deserto? 1.5 : 0) : 0` (°C/s).
- Água disponível `W` = água do tanque **se o tanque estiver acoplado**, senão 0.
- Resfriamento `C = 0.08·(T−20) + (W>5 ? 3.0·tanque/100 : 0)`.
- `T += (H − C)·dt`, limitado a [20, 220]. Equilíbrios com água e tanque 100 (conferir nos testes): L0 45 °C · L1 82,5 · L2 120 · L3 157,5 · L4 195 (superaquece). Sem água: L2 157,5 · L3 195 · L4 explode.
- Consumo de água: `0.025·P` por s; vazamento: se tanque < 50, `−(50−tanque)·0.02` por s; tempestade: `+0.3` por s (chuva recolhida, automático).
- Fontes de água: estação (enche ao máximo), tempestade e **barris** na beira dos trilhos (recurso `water`, §4.5): barril na mão depositado na torneira do tanque = +15.
- Pressão `P = clamp((T−60)/10, 0, 12)` (0 se caldeira = 0). Equilíbrios: L1 2,25 · L2 6 · L3 9,75 · L4 12.
- Superaquecimento: T > 170 (ou 190 com melhoria "Caldeira reforçada") → caldeira −1,5/s. T > 200 → **estouro**: caldeira −25, incêndio na loco (intensidade 0,5), trauma 0,7, recarga 10 s.
- Válvula de alívio: se P > 10,5, alerta "Urgente"; minigame (§7.6) bem-sucedido → T −25.
- Potência `p = min(1, P/8)·(motor/100)`; `vMax = 6.5·p` (com motor 100: L1 1,83 · L2 4,9 · L3/L4 6,5).
- Velocidade: `vt = sign(alvo)·min(|alvo|, vMax)`; `v += clamp(vt − v, −1.0·b·dt, 0.5·dt)`. Sem efeito de rampa (§4.2). Ré (L = −1) usa a mesma potência.
- Freio de emergência (2 s): `v` vai a 0 com desaceleração `3·b`; freios −8; dispara "carga solta" (§6.6 E7). Conta para a conquista SEM_FREIOS.
- Rodas: −0,01·|v| por s; ×3 quando risco > 0,8.
- `s_loco += v·dt`. Imobilizado: `|v| < 0.05` fora da zona da estação por > 90 s ⇒ derrota.

### 5.4 Descarrilamento (domain/train/Derailment.ts)
- `vSafe(κ) = 6.5 − 120·κ` (κ = curvatura em rad/unidade); aderência `α = 1` (0,75 em tempestade).
- Risco `r = |v| / (vSafe·α·w)` para a loco e para o último carro acoplado.
- Estados: `normal` r<0,8 · `instável` 0,8–0,95 (alerta Atenção, trauma 0,1/s) · `crítico` 0,95–1,05 (alerta Crítico, som de alarme, trauma 0,3/s) · `descarrilamento` r>1,05 por 1,0 s contínuo.
- Último carro descarrila (parcial): desacopla e para (`v_d = 0`, estado `descarrilado`). Reencarrilar: locomotiva parada a ≤ 6 do carro + 10 sucata no depósito + segurar E por 8 s na lateral do carro (qualquer jogador naquele carro) ⇒ volta a `desacoplado` (pode ser reengatado).
- Loco descarrila (grave) ⇒ derrota.

### 5.5 Engates e desacoplamento (domain/train/Consist.ts)
- Tensão por engate e tick: `τ = 0.15·|a|·massaAtrás/20 + 1.5·κ·|v| + (estado ≥ instável ? 0.2 : 0)`.
- Desgaste: `engate −= max(0, τ − 0.1)·6·dt` (curva κ=0,02 a v=4,5 ≈ −0,2/s; freio de emergência ≈ −10 por uso). Engate em 0 ⇒ **rompe**: o carro atrás e todos depois dele viram um grupo desacoplado (`CouplingBroke`).
- Física ao romper: remover o corpo da passarela e criar paredes `fixed` `isl:gap:<n>:a` e `:b` (meia-extensão 2,5 × 1,25 × 0,05) nas duas pontas do vão, para ninguém pular entre carros que no mundo estão separados. Ao reengatar, remover as paredes e recriar a passarela. Atravessar só pelo cabo.
- Grupo desacoplado: `s_d += v_d·dt`; `v_d` vai a 0 com desaceleração `0.25 + 0.05·|v_d|`. Navmesh e física: a passarela daquele engate é removida (corpo + polígono da navmesh), o NavAdapter recarrega a navmesh.
- Pontos de engate: cada carro tem engate dianteiro em `s_i + 5.75` e traseiro em `s_i − 5.75` (metade do passo de 11,5). Folga = (engate traseiro do último carro acoplado) − (engate dianteiro do primeiro carro do grupo); acoplado normal = 0.
- Reengate: |folga| ≤ 1,0 e |v_loco − v_d| ≤ 1,0 ⇒ interação "Engatar" no ponto do engate com item **Engate** na mão, segurar E 2 s ⇒ integridade do engate = 60 (100 com a melhoria "Engate reforçado"); a passarela volta (`CarRecoupled`, conquista AINDA_DA_TEMPO). A melhoria também eleva a integridade MÁXIMA dos engates de 100 para 150 (HUD usa `maxEngate1/2`).
- Cabo de resgate: em qualquer ponta de passarela removida, se a distância no mundo entre as pontas ≤ 6 e |Δv| ≤ 1,5, interação "Atravessar (cabo)" (E, 1 s) teleporta o jogador para a ponta do outro carro.
- Carro perdido: grupo desacoplado a > 250 unidades atrás da loco ⇒ perdido (conteúdo perdido; se continha o malote ⇒ derrota "missão obrigatória").

### 5.6 Física na ilha (adapters/PhysicsIslandAdapter.ts) — módulo `physics`
Corpos (todos com `entityId` prefixado `isl:`):
| Corpo | Tipo | Collider |
|---|---|---|
| Piso de cada carro | fixed | box 2,5 × 0,25 × 5 (meia-extensão), topo em y=1 |
| Grades laterais | fixed | box altura 0,6, com abertura de 1,5 nas portas |
| Passarelas | fixed | box 0,8 × 0,1 × 0,75 entre carros |
| Ledges | fixed | box 0,5 × 0,1 × 1,5 fora das portas |
| Componentes (fornalha, caldeira, motor, bancada, depósitos, tanque) | fixed | box do tamanho do modelo |
| Caixas (3, oficina) e malote (cabine da loco) | dynamic | box 0,4³, density 2, friction 0,7 |
| Jogadores | dynamic | sphere r 0,45, density 1, friction 0,8, linearDamping 0,5, restitution 0 |
- Massas (a API não expõe massa): jogador `0,382`, caixa `1,024` (calculadas por densidade×volume; ponha em `balance.ts`).
- Movimento do jogador (domain/player + adapter): com `ψ` = yaw da câmera, `mx = getAxis("MoveRight")`, `mz = getAxis("MoveForward")`: direção no mundo `dx = −mz·sinψ + mx·cosψ`, `dz = −mz·cosψ − mx·sinψ` (W afasta da câmera). No local do carro de yaw `θ`: `lx = dx·cosθ − dz·sinθ`, `lz = dx·sinθ + dz·cosθ`. Normalize se o módulo > 1. Teste obrigatório: ψ=θ=0 e W ⇒ mundo (0,−1); ψ=45° e D ⇒ (cos45°, −sin45°).
- Velocidade desejada `v_des = dirLocal·(3.0 | 4.5 correndo | ×0,7 carregando caixa)`; `v_est = Δpos/dt` (posição do tick anterior); impulso horizontal `m·(v_des − v_est)·0.25`, limitado a `0.5·m` por tick. Pulo: se no chão (`castRay` da base −0,05 para baixo, `maxDistance 0.15`), impulso y `m·5`.
- Forças fictícias (por tick, para cada corpo dinâmico, com a velocidade `v` e a curvatura `κ` do GRUPO/carro onde o corpo está): lateral `a_lat = v²·κ·0.8` para fora da curva; longitudinal `a_long = −(Δv/Δt)·0.8`. Aplique `applyImpulse(m·a·dt)` (não `applyForce`, que é persistente).
- Queda: corpo com `y_local < 1 − 3` ⇒ `PlayerFell`; remove o corpo; após 4 s reaparece na passarela traseira do último carro acoplado; −5 pontos; item na mão perdido (caixa/malote caem = perdidos; malote ⇒ derrota). Caixas que caem: perdidas (−10 pontos).
- Dispose: `removeBody` de todos os corpos `isl:*`.

### 5.7 Pose dos carros no mundo
`pose_i = RailPath.poseAt(s_i)` com `y = ElevationProfile` em s_i + 0,6 (altura do trilho). Acoplados: `s_i = s_loco − 11.5·i`. Desacoplados: `s` próprio. Render interpola entre pose do tick anterior e atual com `alphaInterpolation`.

---

## 6. Sobrevivência, inimigos e eventos

### 6.1 Itens e inventário (domain/survival/Inventory.ts)
- Mão: 1 item de `{carvao, madeira, sucata, barril, baldeVazio, baldeCheio, kit, engate, bomba, barricada, caixa, malote}`.
- Ferramenta ativa (teclas 1/2/3): `gancho | chave | maos`.
- Depósitos: §5.1. Interagir com mão vazia num depósito pega 1; com o recurso certo na mão, deposita.
- Largar (G): item vira objeto? NÃO no MVP: largar só descarta recurso simples (perdido) — exceto caixa/malote, que voltam a ser corpo dinâmico onde o jogador está.
- Inventário (Tab): modal com estoques do trem e da mão (Tab deve dar `preventDefault` no adapter para não trocar foco).

### 6.2 Gancho (coleta)
`UseTool` com gancho: consulta `world.querySpatialGrid({x,z do jogador no mundo}, 9)` por entidades `resource`; pega a mais próxima à frente da câmera; só se `|v_loco| ≤ 3.5`; recarga 1,5 s; mão precisa estar vazia. Efeito: recurso −1 puxada, item na mão, VFX de rastro e som. Rocha no trilho (§6.6 E4) também é alvo do gancho (4 puxadas removem; dá 2 sucata ao depósito).

### 6.3 Reparo (domain/survival/Repair.ts)
| Tipo | Requisito | Tempo (segurar E) | Efeito |
|---|---|---|---|
| Emergencial | chave + 1 sucata na mão | 5 s | +15 |
| Convencional | chave + kit na mão | 3 s | +40 |
| Completo | estação, 10 sucata do depósito | menu | +30 em todos |
| Válvula (minigame) | P > 10,5, na caldeira | minigame | T −25 |
Interromper (sair do alcance ou soltar E) cancela sem consumir.

**Alcances (valem para todo o jogo):** interagir 1,8 · golpe 1,6 · balde 3 · gancho 9 · bomba 8. O host aceita uma ação se a distância ≤ alcance + 0,7 (tolerância de rede).

### 6.4 Fabricação (domain/survival/Crafting.ts) — na bancada, segurar E 2 s (4 s se bancada < 40)
| Item | Custo (depósitos da oficina) |
|---|---|
| Kit de reparo | 3 sucata |
| Engate | 4 sucata + 2 madeira |
| Bomba de sucata | 4 sucata + 1 carvão |
| Barricada | 4 madeira |
Escolha da receita: interagir abre um menu no HUD; teclas Opt1–Opt4 escolhem (enquanto o menu está aberto, Opt* NÃO troca ferramenta).

### 6.5 Bomba e barricada
- Bomba: `UseTool` com bomba na mão lança até 8 unidades à frente; após 2 s explode: remove rocha de trilho no raio 3; remove até 27 blocos de terreno (3×3×3) no ponto (fila G18); VFX explosão + decal de queimado + trauma 0,5 + som; jogadores no raio 2 levam empurrão (impulso 3·m).
- Barricada: colocar numa ledge (interagir) bloqueia surgimento de saqueadores naquela ledge por 40 s.

### 6.6 Diretor de eventos (domain/encounter/EventDirector.ts)
Avalia a cada 20 s (fluxo `DIRECTOR`): se `ativos graves < 2`, sorteia entre os eventos permitidos na fase e fora de recarga, com os pesos da fase. Um evento fica **ativo** do início até a condição de fim; a recarga conta a partir do fim.
| Id | Evento | Custo | Efeito no início | Ativo até | Recarga |
|---|---|---|---|---|---|
| E1 | Vazamento no tanque | 2 | tanque −30 | tanque ≥ 50 ou 45 s | 60 s |
| E2 | Engate danificado | 2 | engate aleatório (acoplado) −40 | engate ≥ 60, rompeu, ou 45 s | 60 s |
| E3 | Saqueadores | 3 | surgem N (§6.7) | nenhum saqueador vivo (máx. 90 s, depois fogem) | 50 s |
| E4 | Pedra nos trilhos | 2 | rocha em `s_loco + 120`; aviso por rádio (toast) imediato; colisão com v > 0,5: rodas −30, motor −15, v = 0, trauma 0,8 | rocha removida ou colisão | 70 s |
| E5 | Incêndio na oficina | 3 | fogo 0,3 na bancada | fogo apagado | 70 s |
| E6 | Tempestade | 2 | clima tempestade | 60 s | 90 s |
| E7 | Carga solta | 1 | impulsos aleatórios (2·m) nas caixas | 5 s | 30 s |
| E8 | Falha na caldeira | 2 | T +40 | 30 s | 60 s |
Pesos por fase (0 = não permitido):
| Fase | E1 | E2 | E3 | E4 | E5 | E6 | E7 | E8 |
|---|---|---|---|---|---|---|---|---|
| Partida | 3 | 0 | 0 | 0 | 0 | 0 | 2 | 0 |
| Escalada | 2 | 2 | 3 | 2 | 1 | 1 | 1 | 2 |
| Crise | 1 | 3 | 3 | 2 | 2 | 1 | 1 | 2 |
| Chegada | 0 | 2 | 0 | 3 | 0 | 0 | 0 | 0 |
Forçados: E1 em t = 60 s de jogo (tutorial, GDD §33); E3 e E6 ao entrar na Crise (ignoram o limite de graves). "Grave" = custo ≥ 2. **Intensidade** = soma dos custos dos eventos ativos (+2 se algum estado crítico de descarrilamento ou T > 170) — dirige a música. "Sobreviveu a um evento grave" = o evento terminou sem a partida acabar (conquista TUDO_SOB_CONTROLE).

### 6.7 Saqueadores (domain/encounter/RaiderBrain.ts + adapters/NavAdapter.ts) — módulo `ai`
- Quantidade por E3: Escalada 2, Crise 3; +1 se ≥ 3 jogadores; máximo 4 vivos.
- Surgem numa ledge livre (sem barricada) da oficina ou do tanque (fluxo `RAIDERS`). antes de registrar, `world.spawnEntity` da entidade `raider:<id>` (tipo `raider`, posição da ledge na ilha) e só então `registerAgent({ agentId, entityId, maxSpeed: 2.2, stoppingDistance: 0.6, navAgentRadius: 0.4, initialPosition, perceptionConfig:{ visionAngleDegrees: 120, visionDistance: 8, checkLineOfSight: true } })`. `despawnEntity` quando sumir.
- Navmesh (`loadNavMesh`) em coordenadas da ilha: retângulos de piso de cada carro, passarelas (só se o engate estiver inteiro), ledges e portas (polígonos de 4 vértices, vizinhos por adjacência). Recarregar a navmesh em todo `CouplingBroke`/`CarRecoupled`.
- FSM do jogo: `Aproximar` (alvo = componente de menor integridade do carro, ou caixa; malote só se não houver outra caixa) → `Sabotar` (≤ 1,2 do componente: −4/s por 8 s) ou `Roubar` (pega caixa: corpo removido, segue o agente) → `Fugir` (vai à ledge mais próxima e some; caixa perdida). `setAgentTarget` em cada mudança; posição lida por `getAgentPosition` a cada tick.
- **Pontos de serviço**: cada componente e depósito tem um ponto de serviço (x,z na ilha) SOBRE a navmesh, a 0,8 da face voltada ao corredor. É o alvo do `setAgentTarget` e a referência das distâncias (≤ 1,2 sabotar; jogadores interagem a ≤ 1,8 do mesmo ponto).
- Ser atingido: `UseTool` com chave ou mãos a ≤ 1,6 e na frente (ângulo < 60°): HP −1 (HP 3), agente **atordoado 1,5 s** (`setAgentTarget` para a própria posição; a API não move agentes); HP 0 ⇒ `Fugir` e derruba a caixa roubada (caixa volta como corpo). `triggerAudioStimulus(pos, 6)` em cada golpe.
- `unregisterAgent` ao sumir e no dispose.

### 6.8 Incêndio (domain/survival/Fire.ts)
Por carro: intensidade I (0–1); +0,04/s (metade em tempestade); dano `4·I`/s no componente mais próximo; I = 1 na oficina ⇒ −1 madeira a cada 5 s. Apagar: balde cheio (`UseTool` a ≤ 3) ⇒ I −0,45. Balde: encher na torneira (água −4).

### 6.9 Clima (domain/encounter/Weather.ts)
`limpo | tempestade`. Tempestade: aderência 0,75, queima +20%, água +0,3/s, propagação de fogo ÷2, VFX chuva, som de chuva (canal `voice`, G20), alerta Info.

### 6.10 Fases, vitória, derrota, pontuação (domain/session)
- Fases por distância absoluta de `s_loco`: Lobby → Introdução (6 s, temporizador do DOMÍNIO; a cutscene é só apresentação) → Partida (s < 300) → Escalada (s < 720) → Crise (s < endS − 240) → Chegada (s ≥ endS − 240) → Fim. Antes da escolha de ramo, `endS` = 1440 (A). **A fase nunca regride.**
- Vitória: `s_loco ≥ endS` com malote a bordo ⇒ quest "Entregar o malote" concluída ⇒ cutscene "chegada" 5 s ⇒ resultados.
- Derrotas: destruição crítica (§5.2) · descarrilamento grave · imobilizado > 90 s · malote perdido.
- Pontos: `distância + 100·carros acoplados ao fim + 50·quests + 20·saqueadores repelidos + 10·reparos − 5·quedas − 10·caixas perdidas`; ×1,5 na vitória. Parafusos (moeda) = ⌊pontos/10⌋.
- Prêmios humorísticos (GDD §32.1) por jogador: Herói dos Trilhos (mais cabos/resgates), Mecânico Incansável (mais reparos), Mãos de Manteiga (mais itens largados/perdidos), Pior Dia de Trabalho (mais quedas), Carregador Oficial (mais itens depositados).

### 6.11 Conquistas (domain/session/Achievements.ts)
| Id Steam | Condição |
|---|---|
| ULTIMO_VAGAO | vencer depois de ter perdido (carro perdido) um vagão |
| MECANICO_DESESPERADO | 3 reparos durante a fase Crise |
| SEM_FREIOS | vencer sem freio de emergência |
| TUDO_SOB_CONTROLE | sobreviver a 5 eventos graves numa partida |
| MESTRE_FERROVIARIO | vencer sem nenhum engate rompido |
| AINDA_DA_TEMPO | reengatar um vagão |
Stat Steam: `distancia_total` = `totalDistance` do save (somado no fim da partida) → `setStat("distancia_total", totalDistance)` + `storeStats()` (a API não tem getStat).

---

## 7. Apresentação (adapters)

### 7.1 Controles (adapters/InputAdapter.ts) — módulo `input`
`setBindingMap` com o mapa COMPLETO (substitui o padrão):
| Ação | Teclas | Uso |
|---|---|---|
| eixo MoveForward | KeyW/KeyS | |
| eixo MoveRight | KeyD/KeyA | |
| Interact | KeyE, GamepadButton2 | segurar = ações temporizadas |
| Sprint | ShiftLeft, GamepadButton4 | |
| Jump | Space, GamepadButton0 | |
| UseTool | Mouse0, GamepadButton1 | |
| Drop | KeyG, GamepadButton3 | |
| Inventory | Tab | |
| QuickMsg | KeyQ | abre o menu de mensagens (Opt1–Opt5) |
| Opt1…Opt5 | Digit1…Digit5 | sem menu aberto: Opt1/2/3 = ferramenta gancho/chave/mãos; com menu (fabricar, mensagens) = escolha |
| CamFollowToggle | KeyC | |
| CamRotate | KeyR | |
| Pause | Escape | |
| Debug | F3 | |
- Bordas (Interact pressionado, Jump, UseTool, Drop, Inventory, QuickMsg, Opt*, Cam*, Pause, Debug) pelo evento `game.input.action` (`state:"pressed"`) — enfileire e consuma no próximo tick. Soltar Interact: `state:"released"`. Contínuos (eixos, Sprint, Interact segurado) lidos no tick.
- **Exceção**: `Pause`, `Inventory`, `Debug` e escolhas de menus são tratados NA HORA no handler do evento (não na fila do tick), porque `GameLoopApi.pause()` congela o tick (G23) e o Esc para sair da pausa nunca seria consumido.
- Roda: listener `wheel` no `document` (passive) → zoom.
- Remapeamento: tela de ajustes troca a tecla de uma ação e chama `setBindingMap` de novo; salvar em ajustes (§7.10).

### 7.2 Câmera (adapters/CameraRig.ts) — módulo `camera`
Receita 10. Tick: `setFollowTarget` com a posição no mundo do jogador local (ou da loco). Zoom: `configureSpringArm`. R: próximo yaw (re-registro). Trauma: estouro 0,7, colisão com rocha 0,8, explosão 0,5, crítico 0,3/s; × opção "Movimento de câmera" (100% / 30% / 0%).

### 7.3 Render (TrainView, CharacterView, DecorView, SunLight) — módulo `render`
- Luz: `setAmbientLight({color:"#cfd8ff", intensity:0.55})`; luz da engine desligada (`setDirectionalLight({color:"#ffffff", intensity:0, position:{x:0,y:1,z:0}, castShadow:false})`); `SunLight` própria via `addMeshToScene` seguindo o foco da câmera, sombra em ±40 (G22).
- Cada carro: `THREE.Group` com o modelo voxel + filhos (fumaça sai da chaminé; pistões animados). Chaves de cena `trem:car:<i>`, `trem:player:<id>`, `trem:raider:<id>`, `trem:decor:<setor>:<tipo>`.
- No `game.loop.render`: interpolar poses (alpha), posicionar grupos, jogadores (`islandToWorld` do carro onde estão), saqueadores, caixas (pelo `getBodyTransform` → mundo).
- Dispose: `removeMeshFromScene` + `geometry.dispose()` + `material.dispose()` de tudo que o jogo criou.

### 7.4 Animação (adapters/AnimAdapter.ts) — módulo `anim`
- Personagem voxel segmentado (cabeça, tronco, braços, pernas). Clips criados no adapter (`THREE.AnimationClip` com `QuaternionKeyframeTrack` nos filhos nomeados): `Idle, Walk, Run, Carry, Repair, Throw, Fall, Downed`.
- `register3DSkeleton(id, root, clips)`; `registerState` para cada clip (`config.id` = nome do clip, `config.name` = estado). Transições explícitas (`addTransition` exige `fromState` concreto): Idle→Walk (`speed > 0.2`), Walk→Idle (`speed <= 0.2`), Walk→Run (`speed > 3.6`), Run→Walk (`speed <= 3.6`), Idle/Walk/Run→Carry (`carrying == true`), Carry→Idle (`carrying == false`). Repair, Throw, Fall e Downed por `playAnimation` direto; ao terminar a ação, `playAnimation("Idle")`.
- Locomotiva: clip `Pistons` (LoopRepeat) com estados `parado`/`rodando` por `speed`.
- Saqueador: mesmo rig, outra paleta.
- `unregisterEntity` no dispose.

### 7.5 Áudio (adapters/AudioAdapter.ts) — módulos `assets`, `audio`
- Pré-carregar com `loadAudio(resolve(url))` todos os sons da tabela antes de liberar o botão "Jogar".
| Som | Uso | Canal | Tipo |
|---|---|---|---|
| apito.wav | partida, estação, chegada | sfx posicional | one-shot |
| clac.wav | trilho: a cada `2/max(|v|,0.3)` s na loco | sfx posicional | one-shot repetido (G20) |
| vapor.wav | fornalha abastecida, válvula | sfx posicional | one-shot |
| metal.wav | dano, golpe, colisão | sfx posicional | one-shot |
| madeira.wav | árvore puxada, barricada | sfx posicional | one-shot |
| alarme.wav | estado crítico (a cada 1,5 s) | ui | one-shot |
| fogo.wav | incêndio (a cada 2 s por foco) | sfx posicional | one-shot |
| chuva.wav | tempestade | voice: `playSound(url,"voice",1,true)` UMA vez após carregar, com canal `voice` em 0; tempestade = `setChannelVolume("voice", 0.7)`, fim = 0 | loop |
| explosao.wav | bomba, estouro | sfx posicional | one-shot |
| pa.wav, reparo.wav, gancho.wav, engate.wav | ações | sfx posicional | one-shot |
| musica-calma.wav, musica-perigo.wav, musica-emergencia.wav, musica-chegada.wav, musica-derrota.wav | música dinâmica | bgm | `crossfadeMusic(url,{durationSeconds:2,loop:true})` |
- Música por intensidade: 0–1 calma, 2–4 perigo, ≥5 ou estado crítico emergência; vitória chegada; derrota derrota.
- Ouvinte: `updateListenerPosition` no render na posição do ALVO da câmera (jogador local/loco), não da câmera (o braço de ~42 atenuaria tudo). Sons posicionais com `refDistance: 6, maxDistance: 60`. `PositionalAudioOptions` não tem canal: o volume "sfx" dos ajustes pode não valer para eles — verifique e registre.
- Volumes por canal nos ajustes (`setChannelVolume`): master, bgm, sfx, ui. O canal `voice` NÃO aparece nos ajustes (é o interruptor da chuva).

### 7.6 HUD e menus (HudView, Menus, ValveMinigame) — módulo `ui`
- `openScreen("hud")` no início. Todo o DOM do jogo vive dentro de `#hud-overlay` (div raiz `#trem-hud`, removida no dispose). Escala do HUD por CSS var `--trem-hud-scale` (ajuste 75–150%).
- Chaves `data-bind` (texto) e `data-hud-fill` (barras) — valores via `ui.bindHUDData` (1×/s para textos lentos) e `ui.updateHUD` (barras, até 10×/s; nunca por tick):
  `speed, distanceLeft, nextStop, fuel/maxFuel, water/maxWater, temp/maxTemp, pressure/maxPressure, motor, caldeira, tanque, rodas, freios, engate1, engate2, phase, weather, bolts`.
- Alertas: lista com ícone + texto + nível (`info | atencao | urgente | critico`), cada nível com forma/ícone diferente (não só cor, GDD §20.5). No máximo 5 visíveis, ordenados por nível.
- Dica contextual: ao chegar a ≤ 1,8 de um interagível — nome, integridade, requisito, ação ("E: Reparar (precisa de kit)").
- Objetivos: lista das quests ativas (do QuestAdapter).
- Barra de progresso de ação segurada (reparo/fabricação/engate).
- Minigame da válvula: barra horizontal com marcador oscilando (período 1,2 s) e zona verde de 20%; E na zona = sucesso; 3 erros = falha (T +10).
- Menus por `pushModal({ id, title, contentHtml, closable })` com botões `data-action`, tratados por UM listener delegado no `#trem-hud`/documento (removido no dispose); `popModal` ao fechar. **Escape texto vindo de jogador/rede.** Telas: Principal (Jogar solo, Criar lobby, Entrar, Garagem, Ajustes, Mods), Lobby, Pausa (só solo: `GameLoopApi.pause()`/`resume()`; o botão "Continuar" e o Esc chamam `resume()` direto no handler), Estação (diálogo), Bifurcação, Resultados, Garagem (cosméticos), Ajustes, Mods, Erro.
- Mensagens rápidas (Q, depois Opt1–Opt5): "Preciso de carvão!", "Vagão desconectando!", "Inimigos na retaguarda!", "Freia o trem!", "Falta água!" — toast para todos (rede) + ícone sobre o jogador (§7.8).

### 7.7 VFX (adapters/VfxAdapter.ts) — módulo `vfx`
| Efeito | Como (G19: re-emitir em rodízio) |
|---|---|
| Fumaça da chaminé | emissor curto `fumaca-<n%4>` a cada 0,5 s na chaminé; taxa ∝ L⁺+1 |
| Vapor da válvula | emissor 1 s |
| Faíscas de reparo | emissor 0,5 s, aditivo |
| Fogo | `fogo-<carro>-<n%3>` a cada 0,5 s enquanto I>0, tamanho ∝ I |
| Destroços cúbicos | `triggerVFXPreset` com `particleEmitter.emitterId` em rodízio `detrito-<n%4>` e `screenShakeTrauma: 0` (o trauma vem só do CameraRig, com a opção de acessibilidade) |
| Chuva | emissor grande em torno do foco, re-emitido a cada 1 s na tempestade |
| Decal queimado | `projectDecal` (textura `textures/queimado.png` pré-carregada com `loadTexture`) onde explodiu / onde houve fogo; `lifetimeSeconds: 60` |
| Pós-processamento | `configurePostProcessing({ enableBloom:true, bloomStrength:0.6 })` uma vez e `pulseBloom` em explosões — sem efeito visível hoje (G9); registre no relatório |
Emissores não têm duração: o VfxAdapter guarda `{id, paraEm}` e chama `stopParticleEmitter(id)` quando o tempo de jogo passa de `paraEm` (fumaça 0,6 s, vapor 1 s, faíscas 0,5 s, fogo 0,6 s, detritos 0,8 s, chuva 1,2 s). No dispose, `stopParticleEmitter` de todos os ids já usados e `clearDecals()`.

### 7.8 Painel de rota e ícones (adapters/RoutePanel.ts) — módulo `sprites`
- Atlas `atlas/icons.png` (ícones 32×32; 23 frames) + `atlas/icons.json` (formato TexturePacker hash) gerados em T01. `await assets.loadTexture(url)`; `parseAtlas(url, json, texture)`.
- Painel na cabine: `renderTilemap({ layerId:"trem-route", atlasUrl, tileMatrix:{ width:32, height:4, tileSize:0.12, tiles } })` — linha do meio = rota (trilho, estação, bifurcação, rocha, fim), tile do trem na posição atual (recalcular a matriz ao mudar de tile, não por frame). O `InstancedMesh` devolvido é posicionado a cada frame no painel da cabine (pose da loco).
- Fatos do tilemap (manual `sprites`): o número N em `tiles` usa o frame `tile_N` do atlas (−1 = vazio); chamar de novo com o mesmo `layerId` substitui. O atlas tem por isso também os frames `tile_0` (vazio-chão), `tile_1` (trilho), `tile_2` (estação), `tile_3` (bifurcação), `tile_4` (rocha), `tile_5` (fim), `tile_6` (trem).
- Ícones flutuantes: `spawnSprite2D` acima de componente com integridade < 40, foco de fogo, saqueador, rocha avisada e mensagem rápida (3 s). Orientar para a câmera a cada frame (copiar quaternion da câmera). `despawnSprite2D` ao sumir.

### 7.9 Missões, diálogos, zonas, cutscenes (adapters/QuestAdapter.ts) — módulo `scripting`
- Quests (`registerQuest` + `startQuest` + `advanceQuestProgress`): `malote` (obrigatória, 1 passo "Entregar o malote na estação final"), tutorial `fornalha` (abasteça 1×), `balde` (encha 1 balde), `primeiro-reparo` (1 reparo), opcionais `carvao-15` (deposite 15 carvão), `reparos-3`, `saqueadores-5`. O HUD lê `quest-updated`.
- Diálogos (`registerDialogueTree`, `startDialogue`, `advanceDialogue(choice)`): `estacao` (Chefe da Estação: Reparo completo / Encher tanque (+água até o máximo, grátis) / Melhorias: Caldeira reforçada 15 sucata · Engate reforçado 12 sucata + 4 madeira · Tanque maior (máx 130) 10 sucata / Sair) e `bifurcacao` (Rota A curta com rochas / Rota B longa com carvão). Rádio (rocha à frente, tempestade chegando): SÓ toast no HUD — NÃO use `startDialogue` (o diálogo é global e derrubaria o da estação).
- Zonas (`registerTriggerZone`): `estacao` (box na plataforma), `bifurcacao-aviso` (s = 900), `chegada` (s = endS−10, registrada só DEPOIS da escolha de ramo; serve só para apito/HUD — a vitória vem do domínio). Entidades checadas no tick com `checkEntityInZones`: `loco` (posição no mundo). Estação: entrar + `|v| < 0.05` por 2 s ⇒ abre diálogo `estacao` (host decide; clientes veem). Bifurcação: entrar ⇒ diálogo `bifurcacao` (host escolhe; padrão A).
- Cutscenes (`registerCutscene` + `playCutscene`): `intro` (6 s) e `chegada` (5 s), com tracks descritivas. Como keyframes não executam nada (G10), o CameraRig faz uma órbita ao receber `cutscene-started` e volta ao normal em `cutscene-finished`. A FASE não depende desses eventos (temporizador do domínio, §6.10); host e clientes tocam a cutscene ao ver a mudança de fase.

### 7.10 Persistência e economia (adapters/SaveAdapter.ts) — módulos `storage`, `monetization`, `security`
- Slots: `trem-progress` `{ version:1, expeditions, wins, bestDistance, totalDistance, bolts, cosmetics: string[], equipped: { paint, whistle }, lastSeed }` e `trem-settings` `{ version:1, volumes, hudScale, cameraShake, bindings }`. `loadGame` no boot (null ⇒ padrão), `saveGame` ao fim da partida e ao mudar ajustes.
- Carteira: no boot, `creditCurrency("parafusos", saved.bolts, "hydrate")` uma única vez; fim de partida `creditCurrency("parafusos", ganhos, "expedicao")`; compra na garagem `debitCurrency`; o valor salvo é sempre `getWalletBalance("parafusos")`.
- Integridade: pontos e ganhos passam por `protectNumber`; antes de creditar/salvar, `verifyIntegrity` — se falhar, não credita e mostra alerta "Valor inválido detectado".
- Catálogo de cosméticos é do jogo (`content.ts`, G13): pinturas da loco (vermelha 50, azul 50, dourada 200), apitos (grave 30, agudo 30). Sem vantagem mecânica.
- Checkpoint de estação (opcional do slice): ao sair da estação, `world.serializeWorldState()` salvo em `trem-checkpoint` (só prova de API; não há "continuar").

### 7.11 Mods (adapters/ModAdapter.ts) — módulo `modding`
- `AssetResolver.resolve(url) = modding.getAssetOverride(url) ?? url` — usado por TODA carga de asset.
- Tela Mods: lista `getLoadedMods()` (vazia sem Steam: "Nenhum mod instalado") e um interruptor "Mod de exemplo: apito alternativo" que faz `registerAssetOverride({ virtualPath:"/projects/trem/audio/apito.wav", realPath:"/projects/trem/mods/demo/apito-alt.wav", modId:"demo-apito", priority:10 })` e recarrega o som. Não há API para remover override: ao DESLIGAR, o `AssetResolver` passa a ignorar overrides do `modId` "demo-apito" (lista de mods desligados nos ajustes) e recarrega o som original; tente também `disableMod("demo-apito")` e registre o efeito no relatório.

### 7.12 Steam e lobby (adapters/SteamAdapter.ts, NetAdapter.ts) — módulos `steam`, `game.steam.net`, `net`
- `steam.isAvailable` falso ⇒ botões de lobby desabilitados com dica "Disponível no app da Steam".
- Conquistas: `ctx.commands.send(UnlockAchievementCommand.type, { achievementId })` (não espere resposta). Stats: `setStat("distancia_total", total)` + `storeStats()` no fim.
- Lobby (só com Steam): host `steamNet.createLobby("friendsOnly", 8)` → `setLobbyData(id, "seed", String(seed))`, `setLobbyData(id, "proto", "1")` e `setLobbyData(id, "host", (await steam.getUser())!.steamId)`; mostra o lobbyId na tela para o amigo digitar. Cliente: tela "Entrar" pede o lobbyId → `joinLobby(id)` → `getLobbyData(id,"host")`/`"seed"`/`"proto"` (proto diferente ⇒ recusar). Não há busca nem convite pela API: registre como lacuna. Sessão P2P: `game.steam.p2p-session-request` ⇒ `acceptP2PSession`. Transporte: `NetworkApi` (`startHost` no host; `connect(hostSteamId)` no cliente).

### 7.13 Overlay (adapters/OverlayAdapter.ts) — módulo `overlay`
Ajuste "Modo transmissão": `setAlwaysOnTop(true/false)` + HUD compacto (só velocidade, integridade geral, alertas). NÃO chame `setPassthrough` nem `setOverlayMode` (G15). Registre no relatório o comportamento sem Tauri.

### 7.14 Segurança e diagnóstico (SecurityAdapter, DebugPanel) — módulo `security`, `game-loop`
- `ProfilerPort` implementado com `beginSubsystemMetric/endSubsystemMetric` em volta de cada sistema do `Simulation.tick` (nomes: `rail, loco, consist, players, fire, director, raiders, net`).
- Erros: listeners `error` e `unhandledrejection` ⇒ `dumpCrashReport(err)` ⇒ modal Erro ("Algo deu errado — relatório gerado: <crashId>"). Removidos no dispose.
- Relógio: no host, a cada 10 s `validateSystemClock(Δms medido)`; falso ⇒ alerta só no painel de debug.
- F3: painel com `GameLoopApi.getStats()`, `PhysicsApi.getStats()`, `getProfilerSnapshot(30)`, `NetworkApi.getStats()`, `StreamingApi.getHLODStats()` + setores ativos, `TerrainApi.getActiveChunkCount()`, `VfxApi.getActiveParticleCount()`, `WorldApi.activeEntityCount`. Atualiza 2×/s.

---

## 8. Multiplayer (domain/net + adapters/NetAdapter.ts)

### 8.1 Porta
```ts
interface NetTransportPort {
  readonly selfId: string; readonly isHost: boolean;
  send(to: string | "all", channel: 0 | 1, bytes: Uint8Array, reliable: boolean): void;
  onMessage(handler: (from: string, channel: number, bytes: Uint8Array) => void): () => void;
  onPeer(handler: (peerId: string, joined: boolean) => void): () => void;
  close(): void;
}
```
Implementações: `NetAdapter` (NetworkApi: `broadcast`/`sendTo`, recepção por `game.net.packet-received`, pares por `game.net.peer-connected/disconnected`) e `testing/LoopbackHub` (N peers em memória, com opção de latência/perda para teste).

### 8.2 Mensagens (domain/net/Protocol.ts) — JSON → `TextEncoder` (versão `proto: 1`)
| Tipo | Canal | Confiável | Direção | Conteúdo |
|---|---|---|---|---|
| Hello | 0 | sim | cliente→host | proto, name, version |
| Welcome | 0 | sim | host→cliente | playerId, seed, branch?, fullSnapshot |
| Input | 1 | não | cliente→host | seq, mx, mz, sprint, interactHeld, edges[] (com redundância das 3 últimas) |
| Snapshot | 1 | não | host→todos | tick, seq, trem (s, v, L, F, T, W, P, integridades, engates, grupos), jogadores (id, carro, x,y,z local, estado, item, ferramenta, anim), saqueadores, caixas, fogo, clima, fase, alertas ativos, quests |
| Event | 0 | sim | host→todos | eventos discretos para áudio/VFX/HUD (o que o bus emitiu) |
| Chat | 0 | sim | ambos | id da mensagem rápida |
| Choice | 0 | sim | host→todos | resultado de diálogo (estação/bifurcação) |
Limites: Snapshot 15 Hz, Input 30 Hz. Pacote NÃO confiável ≤ 1.100 bytes (MTU da Steam): snapshot com arrays (não objetos) e números arredondados a 2 casas. Se passar de 1.100 B, dividir em `SnapshotTrain` e `SnapshotActors` (mesmo `seq`). Teste: 4 jogadores + 4 saqueadores cabem; 8 jogadores dividem corretamente.

### 8.3 Autoridade
- Host roda `Simulation` com todos os jogadores; aplica Inputs por `playerId` (último `seq`); valida interações (alcance ≤ 2,5, item correto) — rejeita silenciosamente o inválido.
- Cliente NÃO simula regras: guarda snapshots e desenha interpolado. Jogadores e saqueadores remotos: `getStateReplicator().pushEntitySnapshot(...)` ao receber (com `sequence` = `seq` do snapshot) e, no render, `getInterpolatedState(id, a)` com `a = clamp((agora − chegadaDoÚltimo) / intervaloEntreSnapshots, 0, 1)` — NÃO o alpha do render (manual `net`). Copie os números do objeto devolvido (é reutilizado). Trem: interpola `s` entre os dois últimos snapshots com o mesmo `a`.
- Pausa não existe em multiplayer (Esc abre menu sem pausar).
- Dificuldade: escala por nº de jogadores (§6.7).

### 8.4 Reconexão
Host mantém o estado de um jogador desconectado por 60 s (personagem fica "Desmaiado" em lugar seguro). `Hello` com o mesmo `name` nesse prazo ⇒ reassume o `playerId` e recebe `Welcome` com snapshot completo. Itens do jogador ficam com ele (sem duplicar).

### 8.5 Testes obrigatórios (T23)
1. 2 peers loopback: cliente anda 3 s e para; após 0,5 s de assentamento, a posição do jogador no cliente = a do último snapshot recebido (tolerância 0,05), e esta = a do host no tick do snapshot.
2. 4 peers: host executa partida headless de 120 s com inputs roteirizados; ao fim o host envia um snapshot final CONFIÁVEL; todos os clientes têm exatamente a mesma fase, integridades e `s` desse snapshot (tolerância 0,01).
3. Perda de 20% no canal 1: estado converge.
4. Reconexão em 30 s: mesmo `playerId`, sem duplicar item.
5. Cliente envia interação inválida (fora de alcance) ⇒ host ignora.

---

## 9. Tarefas (execute em ordem; cada uma termina com os gates)

> Formato: **Objetivo · Arquivos · Passos · Aceite · Testes**. Módulos a ler do manual entre colchetes.

### T00 — Esqueleto do projeto [CORE, RULES, GAPS] **[MARCO]**
- Arquivos: `index.ts`, `TremPlugin.ts`, `config/balance.ts` (vazio com cabeçalho), `ENGINE_REPORT.md` (modelo da §12).
- Passos: copiar a forma de `src/projects/_template/`; manifest da §3.4 com os 23 `dependsOn` e 24 consumes; `setup` só faz `require` de todos os tokens, loga "Trem pronto" e `ready()`.
- Aceite: `VITE_PROJECT=trem npm run build` passa; `project:isolation` passa.
- Testes: `manifest.test.ts` — o manifest consome exatamente os 24 ids e depende dos 23; `permissions.capabilities` igual a consumes; `events` vazio.

### T01 — Gerador de assets
- Arquivos: `tools/gen-assets.mjs` e saída em `public/projects/trem/`.
- Passos: Node puro (`fs`, `zlib`). WAV PCM 16-bit mono 22050 Hz sintetizados (ruído filtrado, senoides, envelopes) para TODOS os sons da §7.5 + `mods/demo/apito-alt.wav`; músicas de 8–12 s em loop (acordes simples). PNG RGBA (encoder mínimo com zlib + CRC32) para `textures/queimado.png` (64×64) e `atlas/icons.png` (16 ícones desenhados por pixel); `atlas/icons.json` no formato `TextureAtlasJSON` (frames por nome: `info, atencao, urgente, critico, fogo, chave, carvao, agua, sucata, madeira, engate, saqueador, estacao, bifurcacao, trem, pedra` e `tile_0`…`tile_6`; atlas 128×160 se precisar de espaço). Determinístico (mesma saída a cada execução).
- Aceite: `node src/projects/trem/tools/gen-assets.mjs` gera tudo; total < 3 MB; rodar 2× não muda hashes.
- Testes: `assets.test.ts` — arquivos existem, cabeçalhos WAV/PNG válidos, JSON tem 23 frames.

### T02 — Base do domínio
- Arquivos: `domain/rng.ts, math.ts, bus.ts, types.ts`, `config/balance.ts` (todas as constantes das §4–§6), `config/content.ts` (dados), `architecture.test.ts`.
- Aceite: §3.2 verificada por teste; rng com sequência fixa para seed 1234 (snapshot dos 5 primeiros valores); bus sem alocação por emit (teste: emitir 10⁵ vezes sem crescer handlers).

### T03 — Rota e elevação [terrain]
- Arquivos: `domain/rail/RailPath.ts`, `ElevationProfile.ts` + testes (§4.1–4.2).

### T04 — Locomotiva
- Arquivos: `domain/train/Locomotive.ts`, `Components.ts` + testes.
- Testes: sem combustível a temperatura cai a 20; equilíbrios de T e P da §5.3 (±2 °C após 150 s com F mantido > 0); L=3 com fornalha cheia atinge P ≥ 8 em < 60 s partindo de 60 °C; sem água em L3 superaquece e a caldeira perde integridade; L4 sem água estoura (> 200); potência zero ⇒ v → 0; ré com L = −1.

### T05 — Composição, engates, descarrilamento
- Arquivos: `domain/train/Consist.ts`, `Derailment.ts` + testes.
- Testes: engate com τ alto rompe e cria grupo; grupo desacelera até 0; reengate só com folga/velocidade dentro do limite e item Engate; risco por curva/velocidade; estados e tempo de 1 s; carro perdido a 250.

### T06 — Itens, reparo, fabricação, fogo
- Arquivos: `domain/survival/*` + testes de cada tabela das §6.1–6.5, §6.8.

### T07 — Partida, pontos, progressão, conquistas
- Arquivos: `domain/session/*` + testes: cada condição de vitória/derrota; fórmula de pontos; parafusos; cada conquista.

### T08 — Diretor e clima
- Arquivos: `domain/encounter/EventDirector.ts`, `Weather.ts`, `Obstacles.ts` + testes: fases permitem só os eventos da tabela; recargas; máximo 2 graves; E1 forçado em 60 s; E3+E6 ao entrar na Crise; determinismo por seed.

### T09 — Simulação headless **[MARCO]**
- Arquivos: `domain/Simulation.ts`, `domain/player/*`, `domain/encounter/RaiderBrain.ts` (FSM pura sobre `NavPort`), portas em `domain/ports/*`.
- Passos: `Simulation.tick(dt, inputs)` chama os sistemas na ordem: inputs → interações → loco → consist/derail → física-ilha (porta) → raiders → fogo → diretor/clima → fase/pontos. Sem engine: portas com fakes de `testing/fakes.ts`.
- Fake da ilha para testes headless (`testing/fakes.ts` → `KinematicIslandFake implements PhysicsIslandPort`): sem física real; cada jogador anda em linha reta até o ponto pedido a 3,0 u/s, sem quedas.
- Teste-chave `simulation.test.ts`: seed 1234, 2 jogadores-bot com esta POLÍTICA (em ordem de prioridade, reavaliada a cada 0,5 s): (1) fogo ativo ⇒ encher balde e apagar; (2) saqueador vivo ⇒ golpear; (3) engate rompido ⇒ fabricar Engate (se faltar sucata, puxar sucata), alavanca −1, reengatar, alavanca 3; (4) P > 10,5 ⇒ válvula (sucesso automático no fake); (5) F < 30 ⇒ pá de carvão; (6) componente < 50 ⇒ kit (fabricar se preciso) e reparar; (7) água < 30 ⇒ puxar barril; (8) senão, puxar o recurso mais próximo e depositar. Alavanca padrão 3; nas curvas com κ ≥ 0,02 manter 4 por 20 s uma vez na Escalada e usar freio de emergência 2× (para provocar rompimento e falha mecânica — documente isso no teste). Escolhe ramo A. Asserções: vitória em ≤ 15 min simulados; ≥ 1 falha mecânica (componente < 40), ≥ 1 `CouplingBroke` seguido de `CarRecoupled`, ≥ 1 evento externo (E3 ou E4). Outro teste: bot passivo (não faz nada) ⇒ derrota (imobilizado ou destruição). Execução < 10 s de CPU.

### T10 — Física da ilha [physics] 
- Arquivos: `adapters/PhysicsIslandAdapter.ts` + teste com fake de `PhysicsApi` (receita 11): cria todos os corpos da §5.6 com ids `isl:*`; impulso de movimento correto; forças fictícias via `applyImpulse`; queda detectada; dispose remove todos os corpos.

### T11 — Render, luz e voxels [render]
- Arquivos: `config/models.ts` (todos os modelos da §4.5/§5.1/§7.4), `adapters/VoxelMesher.ts`, `TrainView.ts`, `CharacterView.ts`, `DecorView.ts`, `SunLight.ts`.
- Testes: mesher elimina faces internas (cubo 2×2×2 = 24 faces externas); cache por id; dispose libera geometrias/materiais (contagem).

### T12 — Câmera e input [camera, input]
- Arquivos: `CameraRig.ts`, `InputAdapter.ts`.
- Testes (jsdom + fakes): mapa completo enviado a `setBindingMap`; borda vinda do evento é consumida uma única vez no tick; zoom limitado 25–70; R gira 45→135→…; trauma × opção.

### T13 — Mundo: índice, terreno, streaming, decoração [world, terrain, streaming]
- Arquivos: `WorldIndexAdapter.ts`, `TerrainAdapter.ts`, `StreamingAdapter.ts`, `DecorView.ts` (complemento).
- Passos: §4.3–4.5, §6.2 (gancho), §6.5 (fila de destruição).
- Testes: janela da loco ⇒ requestChunk/unloadChunk certos ao mudar de setor (≤ 60 ativos); sector-loaded/unloaded ⇒ decoração e recursos criados/removidos; chunk-generated ⇒ alturas no ElevationProfile; recursos entram/saem do índice; fila de destruição ≤ 8 por tick; LOD troca instância.

### T14 — Animação [anim]
- Arquivos: `AnimAdapter.ts`. Testes com fake: clips registrados, transições por parâmetro, `unregisterEntity` no dispose.

### T15 — Áudio [assets, audio]
- Arquivos: `AssetResolver.ts`, `AudioAdapter.ts`. Testes: todo som pré-carregado antes de tocar; clac com intervalo pela velocidade; música troca por intensidade; chuva liga/desliga por volume do canal `voice`; ouvinte atualizado no render.

### T16 — VFX [vfx]
- Arquivos: `VfxAdapter.ts`. Testes: rodízio de ids de fumaça/fogo; decal só após textura carregada; dispose para emissores e limpa decals.

### T17 — Saqueadores [ai, world]
- Arquivos: `NavAdapter.ts` (navmesh da ilha; recarregar em engate rompido/reengatado), integração com `RaiderBrain`.
- Testes: navmesh com passarela some quando engate rompe; FSM aproxima/sabota/rouba/foge; golpe reduz HP; unregister ao sumir.

### T18 — Quests, diálogos, zonas, cutscenes [scripting]
- Arquivos: `QuestAdapter.ts`. Testes: quests registradas e avançadas pelos eventos do bus; zona da estação dispara diálogo após 2 s parado; bifurcação aplica escolha (`chooseBranch`); mudança de fase dispara `playCutscene`.

### T19 — HUD e menus [ui] **[MARCO]**
- Arquivos: `HudView.ts`, `Menus.ts`, `ValveMinigame.ts`.
- Testes (jsdom): chaves data-bind presentes; atualização limitada (não por tick); alertas por nível com ícone; escape de nomes (`<img onerror>` vira texto); minigame sucesso/falha; dispose remove `#trem-hud` e o listener delegado.

### T20 — Painel de rota e ícones [sprites, assets]
- Arquivos: `RoutePanel.ts`. Testes com fake: atlas parseado com a URL como chave; tilemap recalculado só ao mudar de tile; ícones criados/removidos.

### T21 — Progresso, carteira, cosméticos, integridade [storage, monetization, security]
- Arquivos: `SaveAdapter.ts`. Testes com fakes: slot ausente ⇒ padrão; hidratação da carteira única; compra debita e salva; `verifyIntegrity` falso impede crédito; checkpoint chama `serializeWorldState`.

### T22 — Steam [steam, game.steam.net]
- Arquivos: `SteamAdapter.ts`. Testes: sem Steam botões desabilitados e conquistas enviadas por comando sem quebrar; com fake "disponível", lobby criado com seed e proto.

### T23 — Multiplayer [net] **[MARCO]**
- Arquivos: `domain/net/*`, `adapters/NetAdapter.ts`, `testing/LoopbackHub.ts`. Testes da §8.5.

### T24 — Segurança, diagnóstico, loop [security, game-loop]
- Arquivos: `SecurityAdapter.ts`, `DebugPanel.ts`, `LoopAdapter.ts`. Testes: profiler envolve cada sistema; erro global gera crash report e modal; F3 alterna painel; pausa só em solo.

### T25 — Mods e overlay [modding, overlay]
- Arquivos: `ModAdapter.ts`, `OverlayAdapter.ts`. Testes: resolver usa override; interruptor do mod de exemplo; modo transmissão chama só `setAlwaysOnTop`.

### T26 — Composição final e cobertura de capacidades **[MARCO]**
- `TremPlugin.ts` liga tudo; ordem de dispose inversa à criação.
- `capabilities.test.ts`: monta o plugin com um `PluginContext` falso cujos 24 tokens são fakes que registram chamadas; roda 600 ticks de uma partida roteirizada; afirma que CADA capacidade teve ao menos as chamadas listadas na matriz §12 (ex.: terrain.requestChunk, streaming.registerSector, ai.loadNavMesh, sprites.renderTilemap, monetization.creditCurrency, modding.getAssetOverride, overlay.setAlwaysOnTop quando o ajuste é ligado, net.getStateReplicator, steamNet.createLobby com fake disponível…). Depois chama o dispose e afirma que tudo foi liberado (corpos removidos, emissores parados, agentes desregistrados, meshes removidas, listeners desfeitos). O `PluginContext` falso pode ser parcial (`as unknown as PluginContext`) com `id, log, caps, events, commands, lifecycle` implementados; `ctx.commands.send` não exige `permissions.events` (só `emit` é verificado pelo kernel).
- Aceite: todos os gates da §0.4 completos verdes.

### T27 — Smoke visual (se o ambiente permitir)
- `VITE_PROJECT=trem npm run build` e o procedimento de execução nativa de `docs/layer1/native-tauri-steam.md` (xvfb + captura de tela). Capturas: lobby, trem andando, incêndio, estação, resultados. Se não for possível, declare "não executado" no relatório (não finja).

### T28 — Relatório
- Preencher `ENGINE_REPORT.md` (§12). Revisar a SPEC × implementação e listar desvios.

---

## 10. Testes: regras gerais
- Testes ficam ao lado do código, dentro de `src/projects/trem/`.
- Domínio: ambiente node, sem fakes de engine (só portas).
- Adapters com DOM: `// @vitest-environment jsdom` na primeira linha.
- Nada de rede real, nada de Tauri, nada de `localStorage` real (G12).
- Cada fake de token em `testing/fakes.ts` implementa a interface inteira do token (o `tsc` garante) e registra chamadas.

## 11. Orçamentos (verificar no F3 e em teste quando possível)
| Recurso | Limite |
|---|---|
| Corpos físicos na ilha | ≤ 40 |
| Instâncias de decoração por setor | ≤ 400 |
| Partículas ativas | ≤ 2.000 |
| Saqueadores vivos | ≤ 4 |
| Chunks ativos | ≤ 60 |
| Setores ativos | ≤ 8 |
| Modificações de voxel por tick | ≤ 8 |
| Updates de HUD | ≤ 10/s |
| Snapshot (pacote não confiável) | ≤ 1.100 B, 15 Hz |
| Tempo de `Simulation.tick` (headless) | < 1 ms médio |

## 12. ENGINE_REPORT.md (entregável obrigatório)
Modelo:
```md
# ENGINE_REPORT — Trem Fora de Controle
## Matriz de capacidades
| Capacidade | Usada em (arquivo) | Métodos/eventos usados | Status | Evidência |
|---|---|---|---|---|
| game.loop | LoopAdapter | tick, render, pause/resume, getStats | OK / OK com contorno Gx / BUG / NÃO TESTÁVEL (motivo) | teste X / captura Y |
… (24 linhas: 23 + game.steam.net)
## Bugs encontrados (novos)
| # | Módulo | Descrição | Reprodução mínima (teste ou passos) | Severidade |
## Lacunas novas (não listadas em docs/ai/GAPS.md)
## Confirmações de lacunas conhecidas (G1…G24) observadas
## Itens do manual que estavam errados/incompletos
## Desvios da SPEC (o que mudou e por quê)
## Desempenho observado (§11)
```
Status permitidos: `OK`, `OK (contorno Gx)`, `BUG (#n)`, `NÃO TESTÁVEL SEM TAURI/STEAM`. "OK" exige evidência (teste automatizado ou captura).

## 13. Checklist final (copiar para o PR/commit final)
- [ ] T00–T28 concluídas, gates completos verdes.
- [ ] `git status` só mostra `src/projects/trem/**` e `public/projects/trem/**`.
- [ ] Apagar as duas pastas ⇒ `npm run project:isolation` verde.
- [ ] Matriz com 24 linhas preenchidas e evidência.
- [ ] Critérios 1.3.1–1.3.6 demonstrados.
