## notas verificadas (comportamento)
- A engine chama `update(dt)` no tick (agentes param com o jogo pausado). Não chame `update`.
- Navmesh obrigatória: `loadNavMesh(graph, id?)` (padrão "default"; várias coexistem; inválida LANÇA e mantém a anterior). Polígonos convexos com `neighbors` que compartilham (parte de) uma aresta (tolerância 0,01: T-junctions ok); `area`/`cost` opcionais.
- `findPath({ start, target, agentRadius, navMeshId, offMeshPolicy: "clamp" | "fail", areaCosts, excludedAreas })`: caminho suavizado (funnel), respeita raio; destino fora da malha é preso à borda (`clampedTarget`) ou falha com "fail". `projectToNavMesh` para validar pontos.
- Agente: `registerAgent({ agentId, entityId, initialPosition?, maxSpeed: 5, stoppingDistance: 1, navAgentRadius, separationRadius, constrainToNavMesh: true, syncWorldTransform?, syncPhysicsBody?, behavior? })`. Sem `initialPosition` usa a posição da entidade do world.
- Mover: `setAgentTarget(id, ponto)`, `setAgentTargetEntity(id, entidade)` (refaz o caminho a cada `repathInterval`), `stopAgent`, `setAgentPosition(id, p, { keepTarget })` (teleporte). Consulta sem mover: `requestAgentPath`. Leia `getAgentPosition`/`getAgentState` no tick (posição reutilizada: copie).
- Chegada: `game.ai.agent-arrived` UMA vez; `getAgentState().arrived` fica true até novo destino.
- Comportamento: árvore padrão (blackboard `status` = chasing/patrolling/arrived) ou `setAgentBehavior(id, árvore)` declarativa (sequence/selector/parallel/wait/move-to/blackboard/action/condition) com `registerBehaviorAction/Condition`. FSM no jogo chamando `setAgentTarget` também serve.
- Percepção (só do alvo-entidade): visão 20 u / 90°, linha de visão por raio que ignora o agente e conta o alvo; audição = alvo a ≤ `hearingRadius` (padrão 10) — `hearingRadius: 0` desliga. `triggerAudioStimulus(pos, raio)` ⇒ `stimulus-heard` (e investigação só com `investigateStimuli`).
- Agentes NÃO colidem com a física (GAPS G73): a navmesh é a única barreira.
