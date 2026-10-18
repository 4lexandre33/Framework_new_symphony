# Lacunas e riscos da engine que AINDA valem, com contornos

Escrito à mão. Revisado em 2026-10-18 contra o código (tokens, contratos, plugins e `tests/*-gaps.test.ts`) depois das correções dos commits `e21d2ff..4f940f3`. A auditoria de 2026-10-09 listava ~130 itens (G1…G129); quase todos foram CORRIGIDOS. Este arquivo lista só o que continua aberto, parcial ou sem verificação.

Regra: um jogo NÃO altera a engine. Use o contorno e registre o que observar em `src/projects/<jogo>/ENGINE_REPORT.md`.

Gravidade: **A** = bloqueia; **M** = surpresa séria; **B** = detalhe. Tipo: LACUNA (não existe), RISCO (funciona, mas pega desprevenido), DESIGN (intencional), NV (implementado, mas não verificado com Steam real / janela Tauri nativa; os testes usam bridges falsas).

## Resolvido (os IDs antigos citados em outros textos estão CORRIGIDOS)
- núcleo: `commands.send` devolve o retorno do handler e rejeita se ele lançar; `commands.request` exige handler (G29). Erros de handler saem em `kernel.handler.error` (G30). `events: []` = não emite nada, com mensagem clara (G21). `emitAsync` entrega na hora; `emit(…, { copy: true })` (G122). Vários jogos sem `VITE_PROJECT` mostram um seletor (`?project=<id>`) em vez de quebrar (G24). Janela desktop segura por padrão + `src/projects/<jogo>/desktop.json` (G32).
- physics: mover/teleportar qualquer corpo, `setNextKinematicTransform`, velocidades, travas de rotação, massa/sono, colliders compostos com offset, grupos, novas formas, joints + motores, `castShape`/`queryOverlap`, filtros de consulta, `contact-force`, exits ao remover corpo, `getBodyTransform` devolve objeto novo (G1, G2, G33–G36; G37 parcial, ver abaixo).
- game-loop: pausa mantém o render (`isPaused`, delta 0) salvo `freezeRender`; aba oculta suspende e ressincroniza; `setTickRate`/`setTargetFps` com retorno (G23, G38, G39).
- render: interpolação opcional, desenho DEPOIS dos handlers de render, dispose com contagem de referências (`renderRetain`, `disposeResources:false`), API de câmera/viewport, `dispose()` do token é no-op, eventos de perda de contexto, luzes extras e foco de sombra (G22, G40–G44).
- camera: sem câmera virtual o render não é sobrescrito; colisão do braço ignora o alvo; `priority` decide a ativa (com evento); `followTargetId`/`lookAtTargetId`; blend do descritor; trauma global; alvo copiado (G4, G45–G48; oclusão só como evento, G47).
- input: bordas por tick (`isActionPressedInTick`), roda (`getWheelDelta`/`WheelUp`), vários gamepads/analógicos, filtros de foco, `preventDefault` das teclas mapeadas, eventos de pointer lock (G5, G49–G53).
- assets: `loadGLTF` clona por instância, `loadAudio` não espera gesto, `clearCache` respeita refcount, `loadJSON`/`loadBinary`/`preloadManifest`, URL normalizada, `colorSpace` (G79–G83; G81 parcial).
- audio: handles por som, canal posicional, crossfade termina no fim, `stopMusic`, mudo sem Web Audio, limite de vozes, desbloqueio automático no 1º gesto (G20, G27, G84–G87).
- vfx: partículas aparecem e não vazam, emissor móvel com duração/burst, decals projetados com id, pós-processamento real, presets registráveis (G9, G19, G28, G88–G91).
- sprites: sprites, tilemap (1 draw call, UV por tile), animação por quadros, parallax e atlas trimmed/rotated funcionam (G92–G95).
- ui: templates, HTML sanitizado/`contentText`, a engine NÃO captura ESC nem `[data-action]` por padrão, `[data-ui-action]` → `game.ui.action`, dicionários de i18n, `popModal(id)`/`modal-closed`, HUD sem bloquear ponteiro, modo sem DOM (G11, G96–G99).
- terrain: colliders, paleta/cores, streaming automático, lote de edições, 256 de altura, edições persistentes/exportáveis, mistura de biomas, recuperação do worker, água/metadata, `getSurfaceHeight` (G3, G18, G54–G59).
- streaming: origem do centro configurável, `assetUrls` carregados, setores manuais fixos (pin), HLOD real, `unregisterSector`/`clear` seguros, LOD móvel com histerese (G17, G60–G63).
- world: `updateEntityTransform`/`patchEntity`, snapshots imutáveis, spawn tolerante, octree cresce além dos limites, distâncias reais, deserialize valida antes, cena pré-carrega assets (G6, G64–G68; G67 parcial).
- ai: árvores por agente, várias navmeshes/áreas, teleporte, linha de visão filtrada, estímulo sonoro real, clamp 3D, portais tolerantes com raio, funnel, separação, chegada única, `requestAgentPath` puro (G7, G25, G69–G73; G73 parcial).
- anim: reinício (`restart`), exit time, `clip-finished`, ordem livre, sprites pela FSM, relógio único (G74–G78).
- scripting: keyframes executam (câmera/áudio/anim/vfx/diálogo) + evento por keyframe, zonas automáticas (`trackEntity`), variáveis de diálogo, árvores validadas, ciclo de quest completo, exits de zona, varredura e rotação (G10, G123–G128; G129 parcial).
- storage: memória automática em node, perfil online honesto/plugável, backups + HMAC + `loadGameDetailed`, namespace, slots seguros, índice, cota, migrações (G12, G100–G103; G102 parcial).
- net: host sem Steam (loopback `mock`, `broadcast_channel`), handshake, heartbeat, fragmentação, snapshot automático, RTT/perda reais, canais 0..255 (G8 parcial, G104–G108).
- steam: `game.steam.net` FORNECIDO (lobbies, busca, membros, convites, P2P), eventos nativos, stats float, `checkAvailability` no boot (G26, G109–G112).
- security: captura automática de erros, FPS real em janela móvel, heurísticas de speedhack, dump com resultado real e limite por sessão (G16, G113–G115).
- modding: sandbox de scripts em Worker, mods do jogo offline (`installMod`), lista de instalados, lista de ativos persistida, `clear` seguro, fluxo real do Workshop (G14, G116–G118; publicar só nativo).
- monetization: catálogo registrável, compra só por `PurchaseProvider` do servidor (nada de ouro falso), carteira validada, checkout do Steam Inventory (G13, G119, G120).
- overlay: passthrough manual/automático real com raycast 3D, modos aplicam flags nativas, erros expostos, `restoreWindow` (G15, G121).

## Transversais
| # | G | Tipo | Problema | Contorno |
|---|---|---|---|---|
| G31 | B | DESIGN | Objetos reutilizados de propósito (sem alocação): payloads de `game.loop.tick`/`render`, `getInterpolatedState`, `getViewportDimensions`, getters de input (`getMouseDelta`, `getWheelDelta`, `getPointerPosition`…), contexto das ações de IA | Leia na hora; para guardar use `copyTickPayload`/`copyRenderPayload` (contracts/game-loop), `copyEntitySnapshot` (contracts/net), `copyViewportDimensions` (contracts/render). Em DEV, mutar o payload do tick é detectado e revertido |
| G130 | M | RISCO | Aba/janela oculta suspende o loop E o pump da rede (que roda no `game.loop.render`): um HOST oculto para a simulação e os clientes caem por timeout (5 s) | Em multiplayer avise o host para não minimizar; se preciso `net.configure({ peerTimeoutMs })` maior; em solo trate `visibilitychange` (menu de pausa) |
| NV | M | NV | Steam real (conquistas, stats, lobbies, P2P), transporte `steam_p2p`, Workshop (download/publicação UGC), Steam Inventory/MicroTxn, flags nativas do overlay, merge do `desktop.json` e gravação de crash dump em disco: implementados e testados com bridges falsas/Chromium, NÃO com cliente Steam nem janela Tauri reais | O jogo deve funcionar sem nada disso (tudo resolve `false`/`null`/`[]` e não lança); valide no app nativo antes de prometer o recurso; registre o observado no ENGINE_REPORT |

## physics
| # | G | Tipo | Problema | Contorno |
|---|---|---|---|---|
| G37 | B | DESIGN | `step(dt)` manual fora de [1/240, 1] s lança RangeError (a engine nunca chama assim; o tick é 1..240 Hz) | Não chame `step()`; a engine já avança no tick |

## render / assets
| # | G | Tipo | Problema | Contorno |
|---|---|---|---|---|
| G81 | M | RISCO | Clones de `loadGLTF` compartilham geometria/material/textura com o modelo do cache, que não está na cena: `removeMeshFromScene(chave)` de um clone LIBERA esses recursos ainda usados pelo cache/outros clones (o three os reenvia à GPU, com custo) | Para instâncias de GLTF: `removeMeshFromScene(chave, { disposeResources: false })` + `assets.releaseAsset(url)` por instância |

## camera
| # | G | Tipo | Problema | Contorno |
|---|---|---|---|---|
| G47 | B | LACUNA | `detectOcclusion` só emite `game.camera.occlusion-changed` (ids físicos entre câmera e alvo); não há fade automático | O jogo deixa transparentes/oculta as malhas dessas entidades |

## world
| # | G | Tipo | Problema | Contorno |
|---|---|---|---|---|
| G67 | B | RISCO | Após mover/criar entidades a octree é RECONSTRUÍDA inteira na próxima `queryOctree`/`querySphere` (custo O(N) por consulta se houver movimento a cada tick) | Muitas entidades móveis + consultas frequentes: `querySpatialGrid` (XZ, incremental) |

## ai
| # | G | Tipo | Problema | Contorno |
|---|---|---|---|---|
| G73 | M | LACUNA | Agentes não colidem com a geometria física (só separação entre agentes); ficam presos à navmesh (`constrainToNavMesh`, padrão true). `syncPhysicsBody` move o corpo, mas o corpo não bloqueia o agente | Navmesh recuada das paredes; obstáculos = buracos/áreas da navmesh (`excludedAreas`) e recarga da navmesh quando mudam |
| — | B | RISCO | Percepção padrão: visão 20 u / 90°, audição = alvo a ≤ 10 u (sem linha de visão) | Ajuste `perceptionConfig` (ex.: `hearingRadius: 0`) |

## streaming
| # | G | Tipo | Problema | Contorno |
|---|---|---|---|---|
| G132 | M | RISCO | `meshUrl` não vazio de um nível de LOD é CARREGADO via `game.assets` (uma "chave" como `"tree-low"` vira fetch com falha, conta em `assetsFailed`) | Para LOD gerenciado pelo jogo use `meshUrl: ""` e decida pelo `newLevel` do evento `lod-changed` |

## terrain
| # | G | Tipo | Problema | Contorno |
|---|---|---|---|---|
| G133 | B | RISCO | Padrões que surpreendem: água até `seaLevel` 16 (deserto começa em 10, então há lagoas; água não é sólida para `getSurfaceHeight`/colliders) e colliders trimesh LIGADOS por chunk (custo de física mesmo se nada pisa no terreno) | `configure({ generation: { seaLevel: -1 } })` para sem água; `configure({ colliders: { enabled: false } })` se o terreno é só visual |

## ui
| # | G | Tipo | Problema | Contorno |
|---|---|---|---|---|
| G134 | B | RISCO | ESC fecha o modal do topo quando `closable !== false` (padrão da engine; o jogo não muda as opções do plugin) | Modal que o jogo controla pelo teclado (ex.: pausa no ESC): `closable: false`; ou trate `game.ui.modal-closed` com `reason: "escape"` |

## storage
| # | G | Tipo | Problema | Contorno |
|---|---|---|---|---|
| G102 | M | LACUNA | No app o backend é o `localStorage` do WebView (síncrono, cota ~5 MB); serialização JSON síncrona; não há backend IndexedDB/arquivo | Saves pequenos (sem blobs); autosave em momentos parados; capture `quota-exceeded` |
| G131 | M | LACUNA | Driver `steam_cloud` NÃO usa o Steam Remote Storage: é o mesmo `localStorage` com prefixo `steam_cloud_save_` | Trate como local; não prometa sincronização na nuvem |

## net
| # | G | Tipo | Problema | Contorno |
|---|---|---|---|---|
| G8 | M | LACUNA | Não há HOST WebSocket: o navegador não abre servidor e o app nativo não tem servidor WS; `websocket` é só CLIENTE de um servidor/relay externo que fale o protocolo do `game.net`. `webrtc` é reservado (selecionar falha) | Host real por Steam (`steam_p2p`); local: `loopback://sala` (mesmo runtime) ou `bc://sala` (abas da mesma origem); servidor dedicado é projeto à parte |

## modding
| # | G | Tipo | Problema | Contorno |
|---|---|---|---|---|
| G14/G116 | M | LACUNA | Publicar no Workshop exige Tauri + Steam (fora disso `publishWorkshopMod` REJEITA); baixar exige Steam (`false` sem ela) | Offline: mods do jogo via `installMod` + `enableMod`; publicação só no app nativo (NV) |

## monetization
| # | G | Tipo | Problema | Contorno |
|---|---|---|---|---|
| G135 | B | LACUNA | Carteira só em memória (não persiste); catálogo começa com 2 SKUs de exemplo; compra real exige um `PurchaseProvider` do SERVIDOR do jogo (sem ele `initPurchase` resolve `null`) | Salve o saldo via `game.storage` e recredite no boot; `registerCatalog(itens, { replace: true })`; sem servidor, nada de dinheiro real |

## scripting
| # | G | Tipo | Problema | Contorno |
|---|---|---|---|---|
| G129 | B | RISCO | A varredura de zonas (`sweep`, padrão true) é AMOSTRADA: passo ≤ metade da menor extensão da zona, no máximo 32 amostras por tick; deslocamento > 16× a menor extensão pode atravessar uma zona fina sem `entered` | Zonas não muito finas; para teleporte use `{ sweep: false }`; deslocamentos enormes: subdivida no jogo |
