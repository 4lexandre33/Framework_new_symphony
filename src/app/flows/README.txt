PROJETO1 — CAMADA 4 / FLOWS

Path: src/app/flows
Camada arquitetural: Camada 4 — Aplicação / Fluxos
Status: implementação real iniciada e Etapa 44.7 aplicada.

FUNÇÃO
Orquestrar fluxos de alto nível da aplicação e transições de estado usando
serviços, domínio e contratos públicos, sem absorver implementação técnica dos
módulos.

IMPLEMENTAÇÃO ATUAL
- GameFlowFSM.ts
  Máquina de estados de alto nível da aplicação.
- index.ts
  Fachada pública da área app/flows.

GAME FLOW FSM
Estado inicial:
- boot

Estados:
- boot;
- main-menu;
- loading-game;
- playing;
- paused;
- saving;
- returning-to-menu;
- shutdown.

TRANSIÇÕES PRINCIPAIS
boot:
- boot-ready -> main-menu

main-menu:
- start-game -> loading-game

loading-game:
- load-succeeded -> playing
- load-failed -> main-menu

playing:
- pause -> paused
- save-requested -> saving
- return-to-menu -> returning-to-menu

paused:
- resume -> playing
- save-requested -> saving
- return-to-menu -> returning-to-menu

saving:
- save-succeeded -> estado anterior (playing ou paused)
- save-failed -> estado anterior (playing ou paused)

returning-to-menu:
- menu-returned -> main-menu

shutdown:
- terminal

O evento shutdown é permitido a partir de qualquer estado ainda não terminal.

SIDE EFFECTS
GameFlowFSM NÃO executa:
- save/load;
- troca de cenas;
- renderização de menus;
- pause do game loop;
- chamadas Tauri;
- Steamworks;
- plugins;
- filesystem;
- áudio;
- networking.

A FSM apenas valida e registra a transição lógica. O composition root e os
serviços de aplicação executam side effects e depois enviam eventos como
load-succeeded, load-failed, save-succeeded ou save-failed.

PERFORMANCE
- FSM não possui update().
- nenhuma lógica roda por fixed tick ou render frame.
- dispatch() é O(1).
- estado é mutado in-place.
- GameFlowTransition é alocada somente quando um evento discreto é despachado.
- getAllowedEvents() aloca somente quando explicitamente solicitado para
  UI/debug/telemetria.

DIMENSIONALIDADE
GameFlowFSM não contém conceitos espaciais, renderer, Sprite, Mesh, Vector2,
Vector3, física ou câmera. O fluxo é idêntico em jogos 2D, 2.5D e 3D.

DEPENDÊNCIAS PERMITIDAS
- src/services/** e src/domain/** quando a orquestração futura exigir.
- APIs públicas, contracts, ports e capability tokens publicados.
- dependências fornecidas pelo composition root por injeção.

DEPENDÊNCIAS PROIBIDAS
- src/engine/<module>/internal/**.
- src/plugins/** dentro de app/flows.
- Three.js, Babylon.js, Rapier, DOM direto, Tauri ou Steamworks diretamente no
  fluxo.

ETAPA 44
Com GameFlowFSM, a sequência planejada 44.0 -> 44.7 está materializada. O gate
final deve validar arch:audit, TypeScript, suíte completa de testes e build antes
de declarar a Etapa 44 concluída.
