# ai — Inteligência Artificial & NavMesh
capability: game.ai@1.0.0 | category: functional | engine plugin id: game.ai
dependsOn: game.loop, game.physics, game.world
consumes: PhysicsToken, WorldToken
use (from src/projects/<jogo>/**):
  import { AiToken } from "../../tokens/ai";
  // acesso: const api = ctx.caps.require(Token)  (declare o token em capabilities.consumes + permissions.capabilities)

## token src/tokens/ai.ts
```ts
interface AiApi {
  loadNavMesh( graph: NavMeshGraph, navMeshId?: string, ): void; // Valida e carrega uma navmesh (atômico: inválida lança e mantém a anterior).
  findPath( request: NavMeshPathRequest, ): NavMeshPathResult; // Caminho suavizado (funnel) com raio, áreas e destino fora da malha preso a ela.
  registerAgent( config: AIAgentConfig, ): boolean; // Sem `initialPosition` o agente nasce na posição da entidade do world.
  unregisterAgent( agentId: string, ): boolean;
  setAgentTarget( agentId: string, targetPos: Vector3AI, ): NavMeshPathResult; // Anda até o ponto (deixa de seguir entidade).
  setAgentTargetEntity( agentId: string, targetEntityId: string, ): boolean; // Persegue a entidade (posição viva; refaz o caminho quando ela anda).
  setBlackboardValue( agentId: string, key: string, value: BlackboardValue, ): void;
  getBlackboardValue( agentId: string, key: string, ): BlackboardValue | undefined;
  getAgentPosition( agentId: string, ): Vector3AI | null;
  triggerAudioStimulus( position: Vector3AI, loudnessRadius: number, sourceEntityId?: string, ): void; // Estímulo sonoro: agentes a até `loudnessRadius × hearingSensitivity` gravam `lastHeard*` no blackboard e emit…
  update( deltaSeconds: number, ): void;
  unloadNavMesh(navMeshId: string): boolean;
  getNavMeshIds(): string[];
  projectToNavMesh(point: Vector3AI, navMeshId?: string, maxDistance?: number): Vector3AI | null; // Ponto mais próximo sobre a navmesh, ou null.
  requestAgentPath(agentId: string, targetPos: Vector3AI): NavMeshPathResult; // Calcula o caminho a partir do agente SEM movê-lo (emite path-calculated).
  setAgentPosition(agentId: string, position: Vector3AI, options?: SetAgentPositionOptions): boolean; // Teleporte (G25).
  stopAgent(agentId: string): boolean;
  getAgentState(agentId: string): AIAgentState | null;
  registerBehaviorAction(name: string, fn: BehaviorActionFn): boolean; // Ações/condições usadas por nome em `BehaviorNodeDefinition`.
  registerBehaviorCondition(name: string, fn: BehaviorConditionFn): boolean;
  unregisterBehaviorNode(name: string): boolean;
  setAgentBehavior(agentId: string, definition: BehaviorNodeDefinition | null): boolean; // Árvore própria do agente (null = padrão).
}
capability AiToken = "game.ai"@1.0.0 api AiApi
```
## contract src/contracts/ai/types.ts
```ts
export type NodeStatus = | "SUCCESS" | "FAILURE" | "RUNNING";
export type PerceptionSenseType = | "vision" | "hearing" | "none";
interface Vector3AI {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
interface NavMeshPolygon {
  readonly id: number;
  readonly vertices: ReadonlyArray<Vector3AI>; // Polígono convexo (qualquer sentido).
  readonly neighbors: ReadonlyArray<number>; // Ids vizinhos; cada um precisa compartilhar (parte de) uma aresta.
  readonly center: Vector3AI;
  readonly area?: string; // Área/região (ex.: "water", "road") para `areaCosts`/`excludedAreas`.
  readonly cost?: number; // Multiplicador de custo de travessia (>= 0.01).
}
interface NavMeshGraph {
  readonly polygons: ReadonlyArray<NavMeshPolygon>;
}
export type NavMeshOffMeshPolicy = | "clamp" | "fail"; // O que fazer com início/destino fora da navmesh (G71).
interface NavMeshPathRequest {
  readonly start: Vector3AI;
  readonly target: Vector3AI;
  readonly agentRadius?: number; // Portais mais estreitos que 2×raio são intransitáveis; o caminho mantém distância das quinas.
  readonly navMeshId?: string; // Navmesh a usar.
  readonly offMeshPolicy?: NavMeshOffMeshPolicy; // "clamp" (padrão): usa o ponto mais próximo DA navmesh; "fail": found=false.
  readonly maxSnapDistance?: number; // Distância máxima (3D) do ponto à navmesh para o clamp.
  readonly verticalTolerance?: number; // Tolerância vertical para considerar o ponto SOBRE um polígono.
  readonly areaCosts?: Readonly<Record<string, number>>; // Multiplicador de custo por área.
  readonly excludedAreas?: ReadonlyArray<string>; // Áreas proibidas.
}
interface NavMeshPathResult {
  readonly found: boolean;
  readonly waypoints: ReadonlyArray<Vector3AI>; // Caminho suavizado (funnel), do início ao destino.
  readonly totalDistance: number;
  readonly clampedTarget?: Vector3AI; // Destino efetivo quando foi preso à navmesh (G71).
}
interface PerceptionSenseConfig {
  readonly visionAngleDegrees?: number;
  readonly visionDistance?: number;
  readonly hearingRadius?: number;
  readonly checkLineOfSight?: boolean;
  readonly eyeHeight?: number; // Altura dos olhos acima da posição do agente (origem do raio).
  readonly targetHeight?: number; // Altura mirada acima da posição do alvo.
  readonly hearingSensitivity?: number; // Escala do alcance de estímulos sonoros (`triggerAudioStimulus`).
  readonly investigateStimuli?: boolean; // Ao ouvir um estímulo, vai investigar (só se houver caminho; nunca cancela o alvo atual sem caminho).
}
export type BlackboardValue = | string | number | boolean | Vector3AI | object | null;
interface AIAgentConfig {
  readonly agentId: string;
  readonly entityId: string;
  readonly perceptionConfig?: PerceptionSenseConfig;
  readonly maxSpeed?: number;
  readonly maxForce?: number;
  readonly stoppingDistance?: number;
  readonly navAgentRadius?: number;
  readonly initialPosition?: Vector3AI;
  readonly initialForwardDirection?: Vector3AI;
  readonly navMeshId?: string; // Navmesh do agente.
  readonly separationRadius?: number; // Raio de separação entre agentes.
  readonly separationWeight?: number; // Peso da separação.
  readonly constrainToNavMesh?: boolean; // Mantém o agente sobre a navmesh (altura e bordas).
  readonly syncWorldTransform?: boolean; // Escreve a posição na entidade do `game.world` a cada tick.
  readonly syncPhysicsBody?: boolean; // Move o corpo físico da entidade (kinematic: setNextKinematicTransform; outros: teleporte).
  readonly repathInterval?: number; // Intervalo mínimo (s) para refazer o caminho até uma entidade-alvo que se move.
  readonly behavior?: BehaviorNodeDefinition; // Comportamento próprio (G7).
  readonly physicsCollision?: boolean | AIAgentPhysicsCollisionConfig; // G73: colide com a geometria FÍSICA (colliders de `game.physics`) por collide-and-slide com uma cápsula (shape…
}
interface AIAgentPhysicsCollisionConfig { // Cápsula de colisão do agente (G73).
  readonly radius?: number; // Raio da cápsula.
  readonly halfHeight?: number; // Meia-altura do trecho reto da cápsula.
  readonly centerHeight?: number; // Altura do CENTRO da cápsula acima da posição do agente (pés).
  readonly skin?: number; // Folga mantida das superfícies.
  readonly maxIterations?: number; // Iterações de deslize por tick.
  readonly collisionGroups?: { readonly memberships: number; readonly filter: number }; // Filtro de grupos da consulta (ex.: só paredes estáticas).
}
interface BehaviorActionContext { // Contexto passado às ações/condições registradas (reutilizado: não guarde).
  readonly agentId: string;
  readonly entityId: string;
  getBlackboard(key: string): BlackboardValue | undefined;
  setBlackboard(key: string, value: BlackboardValue): void;
  getPosition(): Vector3AI; // Posição atual (objeto reutilizado: copie os números).
  moveTo(target: Vector3AI): boolean; // Pede caminho e começa a andar.
  stop(): void;
  isMoving(): boolean;
  hasArrived(): boolean;
  isTargetSpotted(): boolean;
}
export type BehaviorActionFn = ( context: BehaviorActionContext, deltaSeconds: number, params: Readonly<Record<string, unknown>> | undefined, ) => NodeStatus;
export type BehaviorConditionFn = ( context: BehaviorActionContext, params: Readonly<Record<string, unknown>> | undefined, ) => boolean;
export type BehaviorNodeDefinition = | { readonly type: "sequence" | "selector"; readonly children: ReadonlyArray<BehaviorNodeDefinition> } /** SUCCESS quando `successThreshold` filhos (padrão todos) tiverem sucesso; FAILURE quando não der mais. */ | { readonly type: "parallel"; readonly children: ReadonlyArray<BehaviorNodeDefinition>; readonly successThreshold?: number } | { readonly type: "inverter" | "succeeder" | "failer"; readonly child: BehaviorNodeDefinition } /** Repete o filho `count` vezes (-1 = sempre RUNNING). */ | { readonly type: "repeat"; readonly child: BehaviorNodeDefinition; readonly count?: number } | { readonly type: "wait"; readonly seconds: number } | { readonly type: "action"; readonly name: string; readonly params?: Readonly<Record<string, unknown>> } | { readonly type: "condition"; readonly name: string; readonly params?: Readonly<Record<string, unknown>> } /** SUCCESS se a chave existe (e, com `equals`, se é igual). */ | { readonly type: "blackboard"; readonly key: string; readonly equals?: string | number | boolean | null } | { readonly type: "set-blackboard"; readonly key: string; readonly value: string | number | boolean | null } /** Anda até `position` ou até o Vector3 em `targetKey`: RUNNING andando, SUCCESS ao chegar, FAILURE sem caminho. */ | { readonly type: "move-to"; readonly position?: Vector3AI; readonly targetKey?: string } | { readonly type: "stop" }; // Definição declarativa de árvore (serializável).
interface SetAgentPositionOptions {
  readonly keepTarget?: boolean; // Refaz o caminho até o alvo atual a partir da nova posição (padrão false = para).
}
interface PathCalculatedPayload {
  readonly agentId: string;
  readonly waypointsCount: number;
  readonly success: boolean;
  readonly totalDistance: number;
}
event PathCalculatedEvent = "game.ai.path-calculated" payload PathCalculatedPayload
interface BehaviorStateChangedPayload {
  readonly agentId: string;
  readonly previousState: string;
  readonly newState: string;
}
event BehaviorStateChangedEvent = "game.ai.behavior-changed" payload BehaviorStateChangedPayload
interface TargetSpottedPayload {
  readonly agentId: string;
  readonly targetEntityId?: string;
  readonly position: Vector3AI;
  readonly senseType: Exclude< PerceptionSenseType, "none" >;
}
event TargetSpottedEvent = "game.ai.target-spotted" payload TargetSpottedPayload
interface AgentArrivedPayload {
  readonly agentId: string;
  readonly position: Vector3AI;
  readonly targetEntityId?: string;
}
event AgentArrivedEvent = "game.ai.agent-arrived" payload AgentArrivedPayload // Emitido UMA vez quando o agente chega ao destino (status fica "arrived" até novo alvo).
interface StimulusHeardPayload {
  readonly agentId: string;
  readonly position: Vector3AI;
  readonly loudnessRadius: number;
  readonly distance: number;
  readonly sourceEntityId?: string;
}
event StimulusHeardEvent = "game.ai.stimulus-heard" payload StimulusHeardPayload // Um agente ouviu um estímulo (G70).
interface RequestPathRequest {
  readonly agentId: string;
  readonly targetPosition: Vector3AI;
  readonly move?: boolean; // true = também move o agente (como `setAgentTarget`).
}
command RequestPathCommand = "game.ai.request-path" request RequestPathRequest
interface SetAgentTargetRequest {
  readonly agentId: string;
  readonly targetEntityId: string;
}
command SetAgentTargetCommand = "game.ai.set-agent-target" request SetAgentTargetRequest
interface SetBlackboardValueRequest {
  readonly agentId: string;
  readonly key: string;
  readonly value: BlackboardValue;
}
command SetBlackboardValueCommand = "game.ai.set-blackboard" request SetBlackboardValueRequest
interface AIAgentState {
  readonly agentId: string;
  readonly entityId: string;
  readonly position: Vector3AI;
  readonly velocity: Vector3AI;
  readonly forward: Vector3AI;
  readonly moving: boolean; // Seguindo um caminho.
  readonly arrived: boolean; // Chegou ao último destino (até receber outro).
  readonly status: string | null; // Status do blackboard ("chasing", "patrolling", "arrived" ou o da árvore própria).
  readonly targetEntityId?: string;
  readonly navMeshId: string;
  readonly remainingWaypoints: number;
}
```
## notas verificadas (comportamento)
- A engine chama `update(dt)` no tick (agentes param com o jogo pausado). Não chame `update`.
- Navmesh obrigatória: `loadNavMesh(graph, id?)` (padrão "default"; várias coexistem; inválida LANÇA e mantém a anterior). Polígonos convexos com `neighbors` que compartilham (parte de) uma aresta (tolerância 0,01: T-junctions ok); `area`/`cost` opcionais.
- `findPath({ start, target, agentRadius, navMeshId, offMeshPolicy: "clamp" | "fail", areaCosts, excludedAreas })`: caminho suavizado (funnel), respeita raio; destino fora da malha é preso à borda (`clampedTarget`) ou falha com "fail". `projectToNavMesh` para validar pontos.
- Agente: `registerAgent({ agentId, entityId, initialPosition?, maxSpeed: 5, stoppingDistance: 1, navAgentRadius, separationRadius, constrainToNavMesh: true, syncWorldTransform?, syncPhysicsBody?, behavior? })`. Sem `initialPosition` usa a posição da entidade do world.
- Mover: `setAgentTarget(id, ponto)`, `setAgentTargetEntity(id, entidade)` (refaz o caminho a cada `repathInterval`), `stopAgent`, `setAgentPosition(id, p, { keepTarget })` (teleporte). Consulta sem mover: `requestAgentPath`. Leia `getAgentPosition`/`getAgentState` no tick (posição reutilizada: copie).
- Chegada: `game.ai.agent-arrived` UMA vez; `getAgentState().arrived` fica true até novo destino.
- Comportamento: árvore padrão (blackboard `status` = chasing/patrolling/arrived) ou `setAgentBehavior(id, árvore)` declarativa (sequence/selector/parallel/wait/move-to/blackboard/action/condition) com `registerBehaviorAction/Condition`. FSM no jogo chamando `setAgentTarget` também serve.
- Percepção (só do alvo-entidade): visão 20 u / 90°, linha de visão por raio que ignora o agente e conta o alvo; audição = alvo a ≤ `hearingRadius` (padrão 10) — `hearingRadius: 0` desliga. `triggerAudioStimulus(pos, raio)` ⇒ `stimulus-heard` (e investigação só com `investigateStimuli`).
- Colisão com a física é OPCIONAL (G73; padrão desligado = a navmesh é a única barreira): `physicsCollision: true | { radius, halfHeight, centerHeight, skin, maxIterations, collisionGroups }` faz collide-and-slide da cápsula (shape-cast em XZ via `game.physics`, ignora o próprio corpo e sensores) contra os colliders; a altura continua da navmesh. Não refaz o caminho: obstáculo grande que bloqueia a rota ainda deve virar buraco/área da navmesh.
