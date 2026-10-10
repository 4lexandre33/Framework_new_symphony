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
  loadNavMesh( graph: NavMeshGraph, ): void;
  findPath( request: NavMeshPathRequest, ): NavMeshPathResult;
  registerAgent( config: AIAgentConfig, ): boolean;
  unregisterAgent( agentId: string, ): boolean;
  setAgentTarget( agentId: string, targetPos: Vector3AI, ): NavMeshPathResult;
  setAgentTargetEntity( agentId: string, targetEntityId: string, ): boolean;
  setBlackboardValue( agentId: string, key: string, value: BlackboardValue, ): void;
  getBlackboardValue( agentId: string, key: string, ): BlackboardValue | undefined;
  getAgentPosition( agentId: string, ): Vector3AI | null;
  triggerAudioStimulus( position: Vector3AI, loudnessRadius: number, sourceEntityId?: string, ): void;
  update( deltaSeconds: number, ): void;
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
  readonly vertices: ReadonlyArray<Vector3AI>;
  readonly neighbors: ReadonlyArray<number>;
  readonly center: Vector3AI;
}
interface NavMeshGraph {
  readonly polygons: ReadonlyArray<NavMeshPolygon>;
}
interface NavMeshPathRequest {
  readonly start: Vector3AI;
  readonly target: Vector3AI;
  readonly agentRadius?: number;
}
interface NavMeshPathResult {
  readonly found: boolean;
  readonly waypoints: ReadonlyArray<Vector3AI>;
  readonly totalDistance: number;
}
interface PerceptionSenseConfig {
  readonly visionAngleDegrees?: number;
  readonly visionDistance?: number;
  readonly hearingRadius?: number;
  readonly checkLineOfSight?: boolean;
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
interface RequestPathRequest {
  readonly agentId: string;
  readonly targetPosition: Vector3AI;
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
```
## notas verificadas (comportamento)
- A engine chama `update(dt)` no tick. Não chame `update` no jogo.
- Exige navmesh: sem `loadNavMesh` `findPath`/`setAgentTarget` retornam `found:false` e o agente não anda. Há UMA navmesh global (`loadNavMesh` substitui). Polígonos: vértices + `neighbors` (ids) + `center`.
- O agente se move sozinho (steering) pelos waypoints; leia `getAgentPosition(agentId)` a cada tick para desenhar.
- A árvore de comportamento interna é fixa: blackboard `status` = "chasing" (tem alvo) ou "patrolling". Estados de jogo (sabotar, fugir, roubar) ficam numa FSM do JOGO que chama `setAgentTarget`.
- Percepção só testa o alvo atual (`targetPos` do blackboard), usando `castRay` da física para linha de visão; emite `game.ai.target-spotted` só na borda false→true.
- CORREÇÃO: destino fora da navmesh NÃO falha — é preso ao polígono mais próximo e o agente vai em linha reta até o ponto cru (G71). Valide o destino no jogo.
- Use `perceptionConfig: { checkLineOfSight: false, hearingRadius: 0 }` (G69/G70) e não use `triggerAudioStimulus`. Vértices da navmesh compartilhados EXATAMENTE entre vizinhos (G72).
