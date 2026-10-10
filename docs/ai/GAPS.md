# Lacunas e bugs da engine, com contornos aprovados

Escrito à mão. Auditoria completa das 23 capacidades em 2026-10-09: token, contrato, plugin, `engine/*/internal` e Rust, lidos no código. Leia a seção "Transversais" e as dos módulos que o jogo usa ANTES de planejar.

Regra: um jogo NÃO altera a engine. Use o contorno e registre o que observar em `src/projects/<jogo>/ENGINE_REPORT.md`. Correções da engine são tarefa separada.

Gravidade: **A** = quebra a funcionalidade/bloqueia; **M** = comportamento errado ou surpresa séria; **B** = detalhe. Tipo: BUG, STUB (existe mas não faz), LACUNA (não existe), RISCO. "suspeita" = provável, não rastreado até o fim.

## Transversais (valem para todos os módulos)
| # | G | Tipo | Problema | Contorno |
|---|---|---|---|---|
| G21 | M | RISCO | Plugin `preloaded` com `permissions.events: []` não pode emitir nenhum evento | Liste os tipos emitidos ou use um barramento interno do jogo |
| G24 | A | RISCO | Com 2+ jogos em `src/projects`, o app sem `VITE_PROJECT` lança erro no boot (inclui smokes de release do CI) | Sempre `VITE_PROJECT=<id>`; ajustar CI é decisão do dono do repo |
| G29 | A | BUG | `ctx.commands.send` descarta o retorno do handler: comandos que "respondem" (cast-ray, create-body, load-game, set-active, capture-metrics, create-lobby…) não entregam dados; erros de handler viram só log | Use SEMPRE os métodos do token para obter resultado; comandos só para "dispare e esqueça" |
| G30 | M | RISCO | Exceções em handlers de eventos (inclusive `game.loop.tick`) são engolidas e logadas; o jogo segue com estado parcial | try/catch no seu handler de tick, levando o jogo a um estado de erro explícito |
| G31 | M | RISCO | Vários serviços devolvem objetos internos reutilizados (`getBodyTransform`, `getInterpolatedState`, `getViewportDimensions`, `getEntityState`, payload do tick) | Copie os números na hora; nunca guarde a referência nem a mute |
| G122 | M | RISCO | `ctx.events.emit` ENFILEIRA: os handlers rodam depois (não na mesma chamada) e recebem o payload por REFERÊNCIA | Para lógica imediata use o retorno síncrono dos métodos do token; emita sempre objetos novos (nunca vetores reutilizados) |
| G32 | M | RISCO | `src-tauri/tauri.conf.json` é do template: identifier `com.projeto1.game` comum a todos os jogos (mesmos saves, mods e crash dumps); janela `alwaysOnTop: true`, `transparent: true`, `decorations: false` | Prefixe slots/modIds com o id do jogo; no boot chame `OverlayApi.setAlwaysOnTop(false)` e ofereça "Sair" na UI |

## physics
| # | G | Tipo | Problema | Contorno |
|---|---|---|---|---|
| G1 | A | LACUNA | Não move corpo `fixed`/`kinematic` depois de criado; não lê nem define velocidade | Referencial local ("ilha") parado + desenho com a pose do objeto móvel; velocidade = Δposição/Δt COPIANDO os números (G33) |
| G2 | M | LACUNA | Sem trava de rotação | Personagem = esfera `dynamic`; desenhe em pé usando só a posição |
| G33 | A | BUG | `getBodyTransform` devolve sempre o MESMO objeto por entidade (reescrito a cada chamada) | Copie x/y/z/rotação imediatamente |
| G34 | A | BUG | Remover um corpo (`removeBody`, ou recriar com o mesmo id) nunca emite `collision-exit`/`trigger-exit` | Ao remover, limpe você mesmo os conjuntos de contato daquela entidade |
| G35 | M | LACUNA | 1 collider por corpo, sem offset local, sem grupos/filtros, sem joints, sem shape-cast/overlap, sem cilindro/convexo/heightfield; sem evento de intensidade de impacto | Um corpo por peça; filtre por id no handler; terreno com trimesh `fixed`; impacto ≈ variação de posição |
| G36 | M | RISCO | `castRay` sem filtro: acerta sensores e o próprio corpo; corpo recém-criado só entra nas consultas após o próximo step (suspeita) | Origem fora do corpo; se acertar sensor, relance de `point`+ε; consulte no tick seguinte à criação |
| G37 | B | RISCO | `restitution > 1` e `step` fora de [1/240, 1] lançam RangeError; `setGravity` não acorda corpos dormindo; trigger em `fixed` não detecta `kinematic` (suspeita); trimesh `dynamic` aceito sem aviso | Restitution ≤ 1; `canSleep:false` ou impulso zero para acordar; quem dispara trigger é `dynamic`; trimesh só `fixed` |

## game-loop
| # | G | Tipo | Problema | Contorno |
|---|---|---|---|---|
| G23 | M | RISCO | `pause()` também congela o render | Pausa visual só no menu de pausa; lobby/cutscene são estados do jogo |
| G38 | M | LACUNA | Loop dirigido só por requestAnimationFrame: aba/janela oculta para a simulação; na volta o delta é cortado em 0,25 s | Trate `visibilitychange` (pausar/ressincronizar) |
| G39 | B | STUB | `setTickRate` ignora em silêncio valores fora de 1..240; `targetFps` sempre 60; `stop()`+`start()` durante um frame pode rodar dois frames concorrentes (suspeita) | Confira `getStats().tickRate`; use `pause/resume`, nunca `stop/start` |

## render
| # | G | Tipo | Problema | Contorno |
|---|---|---|---|---|
| G22 | M | LACUNA | Luz direcional única, alvo fixo na origem, sombra só ±15 unidades | Luz própria via `addMeshToScene` seguindo o foco; luz da engine com intensidade 0 |
| G40 | M | STUB | `render(alpha, delta)` ignora os parâmetros (sem interpolação) | O jogo interpola as próprias malhas |
| G41 | M | BUG | O desenho acontece no início do `game.loop.render`, ANTES dos handlers de câmera e do jogo: mudanças feitas no render aparecem 1 frame depois; a câmera usa o transform do frame anterior | Atualize transforms das malhas no `game.loop.tick`; aceite 1 frame de atraso da câmera |
| G42 | M | RISCO | `removeMeshFromScene` faz dispose automático de geometria/material/texturas (exceto se compartilhados com outro objeto registrado); custo O(N) por remoção; `Points`/`Line`/`Sprite` NÃO são liberados | Para esconder use `visible=false`; registre poucos `Group`s; não remova objetos com geometria em cache; libere você mesmo Points/Line |
| G43 | M | LACUNA | Sem API de near/far/fov/tamanho ortográfico (far 1000; ortho restaurado a cada resize); viewport sempre do tamanho da janela, pixelRatio ≤ 2; `game.render.resize` não sai no boot | `getActiveCamera()` + ajuste + `updateProjectionMatrix()` reaplicado em `game.render.resize`; leia `getViewportDimensions()` no setup |
| G44 | B | RISCO | `dispose()` está no token: se o jogo chamar, destrói o renderer de todos; perda de contexto WebGL não gera evento | Nunca chame `RenderApi.dispose()`; ouça `webglcontextlost` no canvas |

## camera
| # | G | Tipo | Problema | Contorno |
|---|---|---|---|---|
| G4 | A | RISCO | `game.camera` sobrescreve a câmera do render a cada frame; re-registrar zera o shake | Controle só por `game.camera` (spring-arm + `setFollowTarget` + `configureSpringArm`) |
| G45 | A | BUG | Spring-arm tem colisão LIGADA por padrão; o raio sai de dentro do collider do alvo e o braço colapsa para 0,2 | `enableCollision: false` (ou socket fora do collider) |
| G46 | M | BUG | `priority` ignorada: a primeira câmera registrada vira ativa sem evento; spring-arm sem `setFollowTarget` usa `position` como ALVO | Sempre `setActiveCamera(id, 0)` após registrar; `setFollowTarget` logo após registrar |
| G47 | M | STUB | `followTargetId`, `lookAtTargetId`, `blendDurationSeconds` do descritor nunca são lidos; `setActiveCamera` sem duração usa blend 0,5 s; sem oclusão/fade | Siga e gire pelo jogo; passe o blend explícito |
| G48 | B | RISCO | Trauma é por câmera (some na troca); `setFollowTarget` guarda a REFERÊNCIA do objeto passado | Reaplique `addTrauma` após trocar; passe um objeto dedicado por câmera |

## input
| # | G | Tipo | Problema | Contorno |
|---|---|---|---|---|
| G5 | M | LACUNA | Sem roda do mouse; bordas bombeadas por frame (não por tick) | Roda via DOM no `document`; bordas pelo evento `game.input.action` |
| G49 | M | RISCO | Chamar `InputApi.update()` (como o comentário do token sugere) apaga as bordas e o delta do mouse | Nunca chame `update()` |
| G50 | M | RISCO | `game.input.action` sai A CADA FRAME para ações mantidas (`held`); toque mais curto que 1 frame emite `pressed` sem `released` | Filtre `state` no handler; "segurando" sempre por `isActionHeld` no tick |
| G51 | M | RISCO | Teclado/mouse capturados em `window` sem olhar foco: digitar num campo dispara ações; clique em botão do HUD dispara `Attack`; sem `preventDefault` (Space rola, Tab tira foco) | Ignore ações com campo do jogo em foco; `stopPropagation` no DOM do HUD; `preventDefault` das teclas usadas num adapter |
| G52 | M | RISCO | `getMouseDelta()` é por frame: lido no tick conta em dobro ou some | Leia no `game.loop.render` e acumule para o tick |
| G53 | M | LACUNA | Só o 1º gamepad; sem analógico direito/gatilhos; `value` sempre 0/1; eixos só aceitam teclas (d-pad não move); zona morta fixa 0,15; sem toque; sem evento de perda de pointer lock | `navigator.getGamepads()` num adapter; d-pad como ações; consulte `isPointerLocked` |

## terrain
| # | G | Tipo | Problema | Contorno |
|---|---|---|---|---|
| G3 | A | LACUNA | Sem colisores; `update` é no-op; uma cor para todos os blocos | Chão físico do jogo; jogo pede/descarrega chunks; cor nas decorações |
| G18 | M | LACUNA | Sem modificação em lote: cada `modifyVoxelBlock` remonta o chunk inteiro | ≤ 8 por tick, em fila |
| G54 | A | BUG | Chunk tem 128 de altura mas montanhas vão a 200: em `y=0` os cumes viram platô reto em 128 | Onde o bioma for `mountains`, peça também `{x,1,z}` e varra a partir de 255 (ou evite montanhas) |
| G55 | A | RISCO | `game.terrain.request-chunk` com seed diferente faz `clear()` do mundo inteiro sem evento | Defina a seed uma vez (`setSeed`) e use só o token |
| G56 | M | LACUNA | `unloadChunk` apaga os voxels (modificações somem ao recarregar); `requestChunk` repetido remonta e reemite `chunk-generated` | Guarde modificações (`block-modified`) e reaplique; ignore `chunk-generated` repetido |
| G57 | M | RISCO | Fronteira de biomas sem mistura: paredes de até ~190 blocos; floresta ≈ 61% do mundo | Evite rotas na fronteira (`getBiomeAt`); escolha a seed testando |
| G58 | M | RISCO | Greedy mesher síncrono na thread principal; fila do worker não cancela; worker que falha ao carregar trava chunks para sempre (suspeita) | 1–2 chunks por tick; timeout no jogo para chunks que não chegam |
| G59 | B | LACUNA | Sem `metadata`, cavernas, água ou transparência; contrato diz `sizeY` 256 (real 128); faces extras nas bordas | Estado de bloco no jogo |

## streaming
| # | G | Tipo | Problema | Contorno |
|---|---|---|---|---|
| G17 | M | RISCO | Centro = posição da câmera; `assetUrls`/`meshUrl` não são carregados | Reaja a `sector-loaded/unloaded` e `lod-changed` |
| G60 | M | BUG | `loadSector`/`force-sector-unload` manuais são desfeitos no ciclo seguinte pela regra de raio | Controle só por raio/centro |
| G61 | M | STUB | HLOD é só contabilidade (`getHLODStats` fictício); `priority` e métricas de load ignoradas | Ignore HLOD |
| G62 | M | RISCO | `clear()` desliga para sempre o centro pela câmera, volta o raio a 100/15 e não emite `sector-unloaded`; não existe `unregisterSector` | Não chame `clear()` durante o jogo; grade fixa de setores |
| G63 | B | LACUNA | Entidade de LOD não se move; `lodLevels` precisam estar em ordem crescente; nível inicial só no tick seguinte; histerese fixa 2,0 | Re-registre para mover; ordene os níveis |

## world
| # | G | Tipo | Problema | Contorno |
|---|---|---|---|---|
| G6 | M | LACUNA | Não há API para mover entidade | `spawnEntity` com o mesmo id SOBRESCREVE (reindexa e reemite `entity-spawned`): use para mover raramente; ou mantenha só entidades paradas |
| G64 | A | BUG | Octree só indexa dentro dos limites da cena (padrão ±500 em X/Y/Z): fora disso `queryOctree` não acha a entidade | `loadScene` com `worldBounds` cobrindo tudo, ou `querySpatialGrid` (2D, sem limite) |
| G65 | M | BUG | `deserializeWorldState` apaga antes de validar (restauração parcial em erro), não restaura `sceneId` nem emite eventos | Guarde o estado anterior; valide o JSON antes |
| G66 | M | STUB | `loadScene` não carrega `assetsToPreload` (progresso falso); `showLoadingScreen`/`autoStartLoop`/`initialEntitiesCount` ignorados; `unloadScene`/`clearPreviousScene` apagam entidades sem `entity-despawned` | Assets pelo `game.assets`; despawn manual antes |
| G67 | M | RISCO | `spawnEntity` sem todos os campos (`position`, `rotation`, `scale`, `tags`) LANÇA; `querySpatialGrid` com raio grande aloca uma string por célula | Preencha tudo (`tags: []`, `customData: {}`); raios pequenos |
| G68 | B | BUG | `queryOctree` devolve `distance` 0; `querySpatialGrid` é XZ e não ordena | Calcule e ordene no jogo |

## ai
| # | G | Tipo | Problema | Contorno |
|---|---|---|---|---|
| G7 | M | LACUNA | Árvore de comportamento fixa; uma navmesh global | FSM no jogo; navmesh estática no referencial local |
| G25 | M | LACUNA | Sem `setPosition` de agente | "Atordoar" = `setAgentTarget` na própria posição; teleporte = unregister+register |
| G69 | A | BUG | Linha de visão quebrada: raio até o CENTRO do alvo, sem filtro (bate no collider do alvo ou nasce dentro do agente) | `checkLineOfSight: false`; visão no jogo com `castRay` comparando `entityId` |
| G70 | M | BUG | "Audição" = proximidade do próprio destino (raio padrão 10): `target-spotted` falso a cada deslocamento; `triggerAudioStimulus` redireciona todos e CANCELA alvos se o caminho falhar | `hearingRadius: 0`; não use `triggerAudioStimulus` |
| G71 | M | BUG | Destino fora da navmesh NÃO falha: preso ao polígono mais próximo e o último waypoint é o ponto cru (atravessa paredes); busca de polígono só em XZ | Valide o destino com point-in-polygon próprio; sem sobreposição em XZ |
| G72 | M | BUG | Portal exige aresta com vértices IDÊNTICOS (T-junction ⇒ `found:false`); A* ignora o raio do agente; `loadNavMesh` inválido deixa estado misto | Vértices compartilhados exatos; `navAgentRadius: 0` com navmesh já encolhida; valide antes |
| G73 | M | LACUNA | Sem funnel (zig-zag); agente cinemático 3D sem colisão nem separação; "arrived" dura 1 tick; `request-path` também MOVE o agente; sem `initialPosition` nasce em (0,0,0) | Polígonos grandes; trate a transição para arrived como evento; consulta pura com `findPath`; sempre `initialPosition` |

## anim
| # | G | Tipo | Problema | Contorno |
|---|---|---|---|---|
| G74 | A | BUG | Pedir de novo o estado atual não reinicia o clip (golpe repetido congela no último quadro; triggers não repetem) | `playAnimation(outro, 0)` e depois `playAnimation(estado, 0)` no mesmo tick |
| G75 | M | LACUNA | Sem "fim do clip"/exit time; transição sem condição dispara no tick seguinte; em LoopRepeat trigger em 1,0 nunca dispara e em 0,0 só uma vez | Trigger em 0,95–0,99 e `playAnimation` ao receber `event-triggered`; triggers entre 0,01 e 0,99 |
| G76 | M | RISCO | `register3DSkeleton` cria um estado por clip e o 1º vira atual sem tocar; `addTransition` falha se os estados não existem; `getCurrentState` só muda no fim do fade (padrão 0,2 s) | Ordem: estados → transições → `playAnimation(inicial, 0)`; guarde o estado pedido |
| G77 | M | LACUNA | Sprite 2D desligado da FSM (toca uma sequência em loop); textura compartilhada anima todos juntos | Re-registre os frames em `state-changed`; textura clonada por entidade |
| G78 | B | RISCO | Relógio da FSM (tick, `durationSeconds`) ≠ relógio do mixer (render); ids com ":" e nomes com espaço quebram triggers/estados | `durationSeconds = clip.duration`; ids sem ":", nomes sem espaço |

## assets
| # | G | Tipo | Problema | Contorno |
|---|---|---|---|---|
| G79 | M | BUG | `loadGLTF` não clona: toda chamada devolve o mesmo `gltf.scene` (registrar duas vezes lança) | `gltf.scene.clone(true)` (ou `SkeletonUtils.clone`) por instância |
| G80 | M | RISCO | `loadAudio` cria um AudioContext próprio e ESPERA `resume()`: fica pendente até o primeiro gesto do usuário | Tela "clique para começar" antes de carregar áudio; nunca `await loadAudio` antes do 1º input |
| G81 | M | RISCO | `clearCache()` libera tudo ignorando refcount; `removeMeshFromScene`/`releaseAsset` liberam recursos ainda usados por clones | Não use `clearCache`; `releaseAsset` só sem instâncias vivas |
| G82 | M | LACUNA | Sem manifesto nem loaders `json`/`binary`; `progress` nunca sai para texturas e sai uma vez (100%) para áudio | `fetch` próprio para JSON; progresso contando promessas |
| G83 | B | RISCO | Chave de cache = URL crua (`./a` ≠ `/a`); toda textura vira SRGB; não funciona em vitest/node | Uma função de URL no jogo; `colorSpace` ajustado para mapas não-cor; mock nos testes |

## audio
| # | G | Tipo | Problema | Contorno |
|---|---|---|---|---|
| G20 | M | LACUNA | Sem handle de som (não para nem move um som) | One-shots repetidos; loop ambiente em canal dedicado com `setChannelVolume` |
| G27 | M | LACUNA | `PositionalAudioOptions` sem canal | Volume pelo campo `volume` |
| G84 | M | BUG | `crossfade-completed` sai no INÍCIO e `crossfadeMusic` resolve na hora; `setChannelVolume(c, v)` sem 3º argumento DESMUTA | Temporize pelo jogo; sempre `setChannelVolume(c, v, isChannelMuted(c))` |
| G85 | M | LACUNA | Sem parar só a música nem saber a faixa atual; crossfade para a mesma faixa reinicia; `stopAllSounds` corta sem fade | `setChannelVolume("bgm", 0)`; o jogo guarda a faixa atual |
| G86 | M | RISCO | Sem WebAudio o plugin falha no setup (node/jsdom); sons pedidos antes do 1º gesto podem tocar todos juntos depois; sem limite de vozes (HRTF caro) | Mock nos testes; não toque antes do 1º input; limite one-shots simultâneos |
| G87 | B | RISCO | Modelo `inverse` ignora `maxDistance`; cones apontam sempre para +X; crossfade libera do cache a faixa que ele mesmo carregou | `distanceModel: "linear"`; não use cones; `loadAudio` antes do crossfade |

## vfx
| # | G | Tipo | Problema | Contorno |
|---|---|---|---|---|
| G9 | M | STUB | Pós-processamento (bloom/SSAO) não é desenhado | Ignore |
| G88 | A | BUG | Partículas NÃO aparecem: o `RawShaderMaterial` usa `position`/`modelViewMatrix`/`projectionMatrix` sem declarar (erro de shader no navegador; em teste parece funcionar) | Partículas do próprio jogo (`InstancedMesh` de cubos, `THREE.Points` + `PointsMaterial`) via `addMeshToScene` |
| G89 | A | BUG | Parar/substituir emissor VAZA geometria/material/textura (Points não é liberado) | Não use emissores da engine (G88) |
| G19/G28 | M | LACUNA | Emissor não se move nem tem duração | Irrelevante enquanto G88 existir |
| G90 | M | LACUNA | Decal é uma caixa texturizada (não projeta); `decalId` ignorado (duplica, sem remover por id); limite 200; sem `lifetimeSeconds` é permanente; textura precisa estar no cache | Só superfícies planas com `size.z` ≈ 0,01; sempre `lifetimeSeconds`; `clearDecals()` na troca de cena |
| G91 | M | BUG | `presetId` nunca é lido; `gravityScale` é aceleração absoluta (padrão 9,81), não escala | Presets montados no jogo |

## sprites
| # | G | Tipo | Problema | Contorno |
|---|---|---|---|---|
| G92 | A | BUG | O plugin não declara `consumes` de render/assets: `spawnSprite2D`, `despawnSprite2D`, `renderTilemap`, `createParallaxBackground`, `clear`, `dispose` e os comandos LANÇAM erro. Só `parseAtlas`, `getFrameUV`, `updateParallax`, `setPixelPerfectScaling` funcionam | Sprites/tilemap do jogo (`PlaneGeometry`/`InstancedMesh` + `MeshBasicMaterial` + `addMeshToScene`) com UVs de `getFrameUV` |
| G93 | A | BUG | Tilemap mostraria o atlas inteiro em cada tile (substituição de shader procura uma linha que não existe no three r170) | Tilemap do jogo (G92) |
| G94 | M | LACUNA | Sem animação de sprite (`animation-ended` nunca emitido); parallax rola em dobro em X e tem tamanho fixo 100×50; atlas ignora `rotated`/`trimmed`; sprite sempre 1×1; frame inexistente mostra o atlas inteiro | Animação e parallax no jogo; atlas sem rotação/trim; escala pelo tamanho do frame |
| G95 | B | RISCO | `parseAtlas`/tilemap mudam filtro e wrap da textura COMPARTILHADA do cache; textura não carregada vira quad vazio sem aviso | URLs distintas por uso; confira `getAsset(url)` antes |

## ui
| # | G | Tipo | Problema | Contorno |
|---|---|---|---|---|
| G11 | M | LACUNA | `templateId` ignorado; `contentHtml` sem sanitização; telas embutidas são placeholders | DOM próprio em `#hud-overlay` ou `pushModal` com texto escapado |
| G96 | A | RISCO | A engine trata cliques em `[data-action]` dentro de `#ui-root` (`start-game` envia `load-scene "level_01"`; outros geram warn) e captura ESC globalmente (abre `pause_menu`, esconde o HUD) | Atributo próprio (`data-<jogo>-action`); ao ver `game.ui.screen-changed` para `pause_menu`, volte com `openScreen("hud")` e trate a pausa no jogo (ou use outra tecla) |
| G97 | M | BUG | `setLocale` reescreve todo `[data-i18n]` (inclusive o DOM do jogo); sem API para registrar dicionários (só 9 chaves da engine); locale desconhecido cai em pt-BR, vazio lança | i18n próprio do jogo com atributo próprio |
| G98 | M | BUG | Comando `pop-modal` ignora `modalId` (fecha o do topo); `depth` ignorado; não há evento de modal fechado | Um modal por vez, com botão de fechar do jogo; detecte por `activeModalCount` |
| G99 | M | RISCO | `#screen-hud` cobre a tela com `pointer-events:auto` sobre o canvas; o binder do HUD varre o DOM a cada `updateHUD`; barras com máximo < 1 viram máximo 1; sem DOM o plugin falha | Listeners em `window`/`document`, nunca no canvas; `updateHUD` só quando mudar e com máximos ≥ 1; jsdom ou mock nos testes |

## storage
| # | G | Tipo | Problema | Contorno |
|---|---|---|---|---|
| G12 | M | RISCO | Em vitest/node não há `localStorage` | Mock de `StorageApi` |
| G100 | A | STUB | Perfil online (`syncOnlineProfile`/`fetchOnlineProfile`) só em memória, mas informa sucesso | Trate "online" como inexistente |
| G101 | A | RISCO | Save corrompido faz `loadGame` REJEITAR (`code:"corrupted"`), sem backup; checksum FNV não é assinatura | try/catch em todo `loadGame`; rodízio de 2 slots; nada competitivo no save |
| G102 | M | RISCO | Chaves sem namespace por jogo (G32); `%` no nome colide slots; nome vazio/>128/controle rejeita; cota ~5 MB; trabalho síncrono na thread principal; `listSaves` lê cada save inteiro | Slots `<jogo>_<nome>` só com `[A-Za-z0-9_-]`; saves pequenos; autosave em momentos parados |
| G103 | M | BUG | Metadados exigem `playTimeSeconds` e `gameVersion` no topo de `data`; sem migração de schema | Inclua os dois campos e um `schemaVersion` próprio; migre após `loadGame` |

## net
| # | G | Tipo | Problema | Contorno |
|---|---|---|---|---|
| G8 | A | LACUNA | Sem host no navegador, sem loopback, sem envio automático de snapshot; `game.net.snapshot` nunca emitido | Porta de rede do jogo; loopback de teste; multiplayer real só Tauri+Steam |
| G104 | A | BUG | Steam: só os canais 0 e 1 são lidos (2–255 somem); não confiável limitado a 1200 bytes | Só canais 0/1, tipo dentro do payload; pacotes ≤ 1.100 B ou confiáveis |
| G105 | A | LACUNA | Queda de par não detectada (Steam; WebSocket após erro); `mode` não volta a offline; `connect` Steam não contata ninguém e aceita qualquer string | Heartbeat (ping 1 s, timeout 5 s); "conectado" só após resposta ao hello; `disconnect()` antes de reconectar |
| G106 | M | BUG | Com Steam ativa, `connect("ws://…")` "conecta" falsamente; WebSocket ignora canal/destino/reliable e marca tudo como `dedicated_server` | Confira `transportType` antes; cabeçalho próprio no payload |
| G107 | M | BUG | Interpolação de quatérnio sem checar sinal; `processWorldSnapshot` nunca remove entidades sumidas e cria entidade para qualquer id; `disconnect`/`connect` limpam o replicador | Corrija o sinal antes do push; `unregisterEntity` dos ausentes; registre entidades só depois de conectar |
| G108 | M | STUB | `rttMs` sempre 0; `packetLossRate` não é perda real; `getStats()` zera contadores; `startHost` ignora `port`/`maxClients` | Ping/pong próprio; limite de jogadores no protocolo |

## steam
| # | G | Tipo | Problema | Contorno |
|---|---|---|---|---|
| G109 | A | LACUNA | `game.steam.net` (SteamNetworkToken) NUNCA é fornecido (intencional, "dormente"): consumi-lo com `optional:false` IMPEDE o boot do jogo; `joinLobby`/`setLobbyData`/`acceptP2PSession` etc. inacessíveis | Não consuma (ou `optional:true` tratando `undefined`); conexão por troca de SteamID fora do jogo + "hello" mútuo |
| G26 | M | LACUNA | Sem busca/convite de lobby, sem membros nem dono (o contorno antigo via `setLobbyData` é INVÁLIDO por G109) | Lobby só como sala do host (`SteamApi.createLobby`); clientes se anunciam por hello |
| G110 | A | STUB | Eventos `p2p-received`, `p2p-session-request`, `lobby-*` nunca emitidos; comandos `join/leave-lobby`, `accept-p2p-session` não tratados | Receber por `game.net.packet-received`; lista de jogadores no protocolo do jogo |
| G111 | M | BUG | Pacote recebido > 1 MB trava o canal para sempre | Protocolo pequeno |
| G112 | M | LACUNA | `setStat` só inteiro (trunca; stats float falham) e precisa de `storeStats`; set antes das stats chegarem pode falhar (suspeita); `isAvailable` começa `false` | Stats INT; repetir desbloqueio quando der `false`; `await checkAvailability()` antes de decidir |

## security
| # | G | Tipo | Problema | Contorno |
|---|---|---|---|---|
| G16 | M | LACUNA | Sem captura automática de erros | Listeners `error`/`unhandledrejection` → `dumpCrashReport` |
| G113 | M | BUG | Profiler usa o delta FIXO do tick: `fps` sempre = tick rate; métricas acumuladas desde o início (sem janela) | FPS medido pelo jogo; nomes fixos; `clear()` periódico se quiser janela |
| G114 | M | RISCO | Sem detecção automática de speedhack; `validateSystemClock` mede desde a chamada ANTERIOR (estado global) e no navegador sempre passa; descritor protegido é forjável | Um único chamador periódico; nada competitivo no cliente |
| G115 | M | RISCO | Crash dump resolve mesmo sem gravar; pasta comum a todos os jogos, sem rotação; `activeSceneId` sempre "desconhecida"; cada dump cria um contexto WebGL (suspeita de derrubar o do jogo) | Limite de dumps por sessão, só erros fatais; cena no texto da mensagem |

## modding
| # | G | Tipo | Problema | Contorno |
|---|---|---|---|---|
| G14 | M | LACUNA | Offline não há mods; publicar rejeita | Só `registerAssetOverride`/`getAssetOverride` |
| G116 | A | STUB | `entryScript` nunca executa (mods só de dados); download do Workshop é falso (100% instantâneo, nunca instala); publicação sempre falha, inclusive no app nativo | Mods de dados/assets interpretados pelo jogo; publicar fora do jogo (SteamCMD) |
| G117 | A | BUG | `realPath` de mods em disco não resolve (sem `convertFileSrc`/assetProtocol); sem API para listar mods instalados (só ativados) | Overrides só para assets empacotados no jogo; lista de modIds conhecida |
| G118 | M | BUG | `clear()` inutiliza o módulo; Rust e TS validam o manifesto diferente (mod some sem aviso); `minEngineVersion` comparado com a API do kernel 1.0.0; overrides sem normalização de caminho; mods ativos não persistem | Nunca `clear()`; preencha todos os campos; `minEngineVersion: "1.0.0"`; caminho canônico; salve a lista e reative no boot |

## monetization
| # | G | Tipo | Problema | Contorno |
|---|---|---|---|---|
| G13 | M | LACUNA | Catálogo fixo (2 SKUs) | Catálogo do jogo |
| G119 | A | BUG | Compra é 100% falsa TAMBÉM no app nativo (`initPurchase`+`finalizePurchase` dão ouro sem cobrança); comandos Rust sempre falham; validação de recibo só no cliente com sal embutido | Não exponha loja de dinheiro real; trate monetização real como inexistente |
| G120 | M | BUG | `debitCurrency(NaN)` retorna true e deixa o saldo NaN; `creditCurrency` ≤ 0 emite `wallet-updated` sem mudar nada; compra só credita "gold"; `clear()` esvazia o catálogo para sempre | Valide `Number.isSafeInteger(v) && v > 0`; nunca `clear()` |

## overlay
| # | G | Tipo | Problema | Contorno |
|---|---|---|---|---|
| G15 | A | BUG | O tick chama `update(0,0)` sempre: qualquer `setPassthrough(true)` é desfeito no tick seguinte (click-through impossível). Por padrão a janela NÃO ignora cliques; MAS se o pixel (0,0) ficar sem elemento interativo (canvas com `pointer-events:none`/oculto, body sem margem), a janela INTEIRA passa a ignorar o mouse | Mantenha algo interativo (ou o canvas) cobrindo o pixel (0,0); não use passthrough |
| G121 | M | STUB | `setOverlayMode` só guarda texto; dock da barra com limites fixos fora do Windows; erros nativos engolidos (getters mentem); `clear()` não reverte o nativo | `setAlwaysOnTop` manual; não confie nos getters; não chame `clear()` |

## scripting
| # | G | Tipo | Problema | Contorno |
|---|---|---|---|---|
| G10 | M | LACUNA | Keyframes de cutscene não fazem nada; zonas não são checadas sozinhas | Jogo reage a `cutscene-started/finished` e chama `checkEntityInZones` no tick |
| G123 | A | STUB | Condição de escolha (`conditionVariable`/`requiredValue`) sempre falha (não há `setVariable` público) | Não use condições; o jogo filtra as escolhas e só envia índices válidos |
| G124 | A | BUG | `choiceIndex` inexistente (ou `advanceDialogue()` sem índice num nó com escolhas) segue o default ou ENCERRA o diálogo em silêncio; `startDialogue` com id inválido encerra o ativo; árvore não é validada; fim do diálogo não emite evento; um diálogo global (novo substitui sem evento) | Valide índices em `getCurrentDialogueNode().choices`; valide a árvore antes de registrar; trate retorno `null` como fim; fila de diálogos no jogo |
| G125 | M | STUB | `audioClipUrl`/`animationState` do nó, `targetEntityId`/`rewardXp`/`rewardItems` da quest e `targetTags` da zona são ignorados | O jogo reage a `dialogue-changed`/`quest-updated` e filtra por entidade |
| G126 | M | BUG | `startQuest` numa quest ativa/concluída REINICIA (recompensa em dobro); `registerQuest` com id existente apaga o estado; status `failed` inalcançável; sobra de progresso descartada; sem evento dedicado de conclusão | `getQuestState(id) === null` antes de iniciar; registre só no boot; falha guardada no jogo; avance de 1 em 1 |
| G127 | M | BUG | `triggerOnce` é por ZONA (a 1ª entidade desliga para todas e nunca sai `exited`); `unregisterTriggerZone`/re-registro com gente dentro não emite `exited`; entidade destruída fica "dentro" para sempre | `triggerOnce: false` e controle no jogo; antes de remover entidade, `checkEntityInZones(id,{x:Infinity,y:Infinity,z:Infinity})` |
| G128 | M | LACUNA | Cutscene: pausa não retoma (`playCutscene` recomeça do 0); trocar de cutscene não emite `finished` da anterior; `stop` emite o mesmo `finished` (sem motivo); sem tempo decorrido | `stopCutscene()` antes de cada `playCutscene`; flag `skipped` no jogo; cronometre no jogo |
| G129 | B | RISCO | Zonas: esfera/cilindro usam `dimensions.z` como raio; caixa centrada sem rotação; amostragem discreta (entidade rápida atravessa); `clear()` apaga tudo sem eventos; comandos sem payload lançam | Raio em `z`; subdivida deslocamentos grandes; nunca `clear()`; use os métodos do token |
