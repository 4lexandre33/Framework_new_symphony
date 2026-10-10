## notas verificadas (comportamento)
- A engine chama `update(dt)` no tick. Não chame `update` no jogo.
- Exige navmesh: sem `loadNavMesh` `findPath`/`setAgentTarget` retornam `found:false` e o agente não anda. Há UMA navmesh global (`loadNavMesh` substitui). Polígonos: vértices + `neighbors` (ids) + `center`.
- O agente se move sozinho (steering) pelos waypoints; leia `getAgentPosition(agentId)` a cada tick para desenhar.
- A árvore de comportamento interna é fixa: blackboard `status` = "chasing" (tem alvo) ou "patrolling". Estados de jogo (sabotar, fugir, roubar) ficam numa FSM do JOGO que chama `setAgentTarget`.
- Percepção só testa o alvo atual (`targetPos` do blackboard), usando `castRay` da física para linha de visão; emite `game.ai.target-spotted` só na borda false→true.
- CORREÇÃO: destino fora da navmesh NÃO falha — é preso ao polígono mais próximo e o agente vai em linha reta até o ponto cru (G71). Valide o destino no jogo.
- Use `perceptionConfig: { checkLineOfSight: false, hearingRadius: 0 }` (G69/G70) e não use `triggerAudioStimulus`. Vértices da navmesh compartilhados EXATAMENTE entre vizinhos (G72).
