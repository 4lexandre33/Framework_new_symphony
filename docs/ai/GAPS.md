# Lacunas da engine e contornos aprovados (escrito à mão; verificado no código em 2026-10-09)

Regra: um jogo NÃO altera a engine. Quando faltar API, use o contorno abaixo e anote a lacuna no relatório do jogo (`src/projects/<jogo>/ENGINE_REPORT.md`). Extensões de API viram tarefa separada da engine.

| # | Módulo | Lacuna | Contorno sem tocar na engine |
|---|---|---|---|
| G1 | physics | Não move corpo `fixed`/`kinematic` depois de criado; não lê nem define velocidade | **Referencial local**: simule tudo que está "dentro" de algo móvel (ex.: pessoas num trem) num espaço físico parado, longe da área visível, e desenhe aplicando a transformação do objeto móvel. Velocidade = Δposição/Δt via `getBodyTransform`. |
| G2 | physics | Sem trava de rotação | Personagem = esfera `dynamic`; o modelo é desenhado em pé usando só a posição. |
| G3 | terrain | Sem colisores; `update` é no-op; uma única cor para todos os blocos | Chão físico do jogo (caixas `fixed`); o jogo pede/descarrega chunks; cor por bioma só em objetos do jogo (árvores, rochas). |
| G4 | camera/render | `game.camera` sobrescreve a câmera do render a cada frame; re-registrar câmera zera o shake | Controle só por `game.camera`: spring-arm + `setFollowTarget` + `configureSpringArm` (zoom). Re-registre só ao girar. |
| G5 | input | Sem roda do mouse; bordas (`pressed`) bombeadas por frame, não por tick | Roda via listener DOM num adapter; bordas pelo evento `game.input.action`. |
| G6 | world | Não há como atualizar posição de entidade | Mantenha no `world` entidades paradas no seu referencial (ex.: componentes do trem em coordenadas locais); posições móveis ficam no estado do jogo. |
| G7 | ai | Árvore de comportamento fixa (chasing/patrolling); uma navmesh global; exige navmesh | FSM de alto nível no jogo; navmesh em coordenadas do referencial local (estática). |
| G8 | net | Sem host no navegador, sem loopback, sem envio automático de snapshot | Porta de rede do jogo + adapter sobre `NetworkApi`; testes com transporte loopback de teste. Multiplayer real só Tauri+Steam. |
| G9 | vfx | Pós-processamento (bloom/SSAO) não é desenhado | Use partículas, decals e `addTrauma`; trate bloom como opcional sem efeito visível. |
| G10 | scripting | Keyframes de cutscene não fazem nada; zonas não são checadas sozinhas | Jogo reage a `cutscene-started/finished` e chama `checkEntityInZones` no tick. |
| G11 | ui | `templateId` ignorado; `contentHtml` sem sanitização; telas embutidas são placeholders | DOM próprio num adapter (dentro de `#hud-overlay`) ou `pushModal({contentHtml})` com texto escapado. |
| G12 | storage | Em vitest/node não há `localStorage` | Mock de `StorageApi` nos testes. |
| G13 | monetization | Catálogo fixo (2 SKUs), sem registro de itens | Catálogo de cosméticos no jogo; carteira da engine só para saldo. |
| G14 | modding | Offline não há mods; publicar rejeita | Use só `registerAssetOverride`/`getAssetOverride` para resolver URLs. |
| G15 | overlay | Hit-test 3D não ligado; suspeita: tick reavalia passthrough pelo pixel (0,0) | Não ative modos de overlay sem teste no app nativo. |
| G16 | security | Sem captura automática de erros | Listeners `error`/`unhandledrejection` num adapter → `dumpCrashReport`. |
| G17 | streaming | Centro = câmera; `assetUrls`/`meshUrl` não são carregados | Use os eventos `sector-loaded/unloaded` e `lod-changed` para o jogo criar/remover/trocar conteúdo. |
| G18 | terrain | Sem modificação em lote: cada `modifyVoxelBlock` remonta o chunk inteiro | Destruição pontual (≤ 8 blocos por tick, em fila); nada de escavar corredores. |
| G19 | vfx | Emissor não se move | Re-emitir emissores curtos em rodízio na posição atual. |
| G20 | audio | Sem handle de som: não para um som específico nem move som posicional | One-shots curtos repetidos; loop ambiente num canal dedicado controlado por `setChannelVolume`; música por `crossfadeMusic`. |
| G21 | core | Plugin `preloaded` com `permissions.events: []` NÃO pode emitir nenhum evento | Liste cada tipo emitido em `permissions.events` (ou não emita eventos do kernel; use um barramento interno do jogo). |
| G22 | render | Luz direcional única com alvo fixo na origem (sombra some longe da origem) | Luz do jogo via `addMeshToScene` seguindo o foco; luz da engine com intensidade 0. |
| G23 | game-loop | `pause()` também congela o render | Pausa visual só para menu de pausa; estados de lobby/cutscene são do jogo. |
| G24 | host | Com 2+ jogos em `src/projects`, o app sem `VITE_PROJECT` lança erro no boot (afeta `dev`, `tauri` e smokes de release do CI que não definem a variável) | Sempre `VITE_PROJECT=<id>`. Ajustar workflows de CI é decisão do dono do repositório, fora do escopo do jogo. |
| G25 | ai | Não há como reposicionar um agente (sem setPosition) | "Atordoar" com `setAgentTarget` na própria posição; teleporte = `unregisterAgent` + `registerAgent` com `initialPosition`. |
| G26 | steam.net | Sem busca/convite de lobby e sem getter do dono do lobby | Host grava `setLobbyData(id,"host",steamId)`; o cliente entra digitando o lobbyId. |
| G27 | audio | `PositionalAudioOptions` não tem canal (volume "sfx" pode não valer para sons posicionais) | Verificar e registrar; controlar o volume pelo campo `volume` da chamada. |
| G28 | vfx | Emissor não tem duração | O jogo agenda `stopParticleEmitter` pelo tempo de jogo; ids em rodízio. |
