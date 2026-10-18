import {
  defineCommand,
  defineEvent,
} from "@core";

export type NodeStatus =
  | "SUCCESS"
  | "FAILURE"
  | "RUNNING";

export type PerceptionSenseType =
  | "vision"
  | "hearing"
  | "none";

export interface Vector3AI {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface NavMeshPolygon {
  readonly id: number;

  /** Polígono convexo (qualquer sentido). Arestas compartilhadas podem ter T-junctions. */
  readonly vertices:
    ReadonlyArray<Vector3AI>;

  /** Ids vizinhos; cada um precisa compartilhar (parte de) uma aresta. */
  readonly neighbors:
    ReadonlyArray<number>;

  readonly center:
    Vector3AI;

  /** Área/região (ex.: "water", "road") para `areaCosts`/`excludedAreas`. */
  readonly area?:
    string;

  /** Multiplicador de custo de travessia (>= 0.01). Padrão 1. */
  readonly cost?:
    number;
}

export interface NavMeshGraph {
  readonly polygons:
    ReadonlyArray<NavMeshPolygon>;
}

/** O que fazer com início/destino fora da navmesh (G71). */
export type NavMeshOffMeshPolicy =
  | "clamp"
  | "fail";

export interface NavMeshPathRequest {
  readonly start:
    Vector3AI;

  readonly target:
    Vector3AI;

  /** Portais mais estreitos que 2×raio são intransitáveis; o caminho mantém distância das quinas. */
  readonly agentRadius?:
    number;

  /** Navmesh a usar. Padrão "default". */
  readonly navMeshId?:
    string;

  /** "clamp" (padrão): usa o ponto mais próximo DA navmesh; "fail": found=false. */
  readonly offMeshPolicy?:
    NavMeshOffMeshPolicy;

  /** Distância máxima (3D) do ponto à navmesh para o clamp. Padrão infinito. */
  readonly maxSnapDistance?:
    number;

  /** Tolerância vertical para considerar o ponto SOBRE um polígono. Padrão 2. */
  readonly verticalTolerance?:
    number;

  /** Multiplicador de custo por área. */
  readonly areaCosts?:
    Readonly<Record<string, number>>;

  /** Áreas proibidas. */
  readonly excludedAreas?:
    ReadonlyArray<string>;
}

export interface NavMeshPathResult {
  readonly found:
    boolean;

  /** Caminho suavizado (funnel), do início ao destino. */
  readonly waypoints:
    ReadonlyArray<Vector3AI>;

  readonly totalDistance:
    number;

  /** Destino efetivo quando foi preso à navmesh (G71). */
  readonly clampedTarget?:
    Vector3AI;
}

export interface PerceptionSenseConfig {
  readonly visionAngleDegrees?:
    number;

  readonly visionDistance?:
    number;

  readonly hearingRadius?:
    number;

  readonly checkLineOfSight?:
    boolean;

  /** Altura dos olhos acima da posição do agente (origem do raio). Padrão 0. */
  readonly eyeHeight?:
    number;

  /** Altura mirada acima da posição do alvo. Padrão 0. */
  readonly targetHeight?:
    number;

  /** Escala do alcance de estímulos sonoros (`triggerAudioStimulus`). Padrão 1; 0 = surdo. */
  readonly hearingSensitivity?:
    number;

  /** Ao ouvir um estímulo, vai investigar (só se houver caminho; nunca cancela o alvo atual sem caminho). Padrão false. */
  readonly investigateStimuli?:
    boolean;
}

export type BlackboardValue =
  | string
  | number
  | boolean
  | Vector3AI
  | object
  | null;

export interface AIAgentConfig {
  readonly agentId:
    string;

  readonly entityId:
    string;

  readonly perceptionConfig?:
    PerceptionSenseConfig;

  readonly maxSpeed?:
    number;

  readonly maxForce?:
    number;

  readonly stoppingDistance?:
    number;

  readonly navAgentRadius?:
    number;

  readonly initialPosition?:
    Vector3AI;

  readonly initialForwardDirection?:
    Vector3AI;

  /** Navmesh do agente. Padrão "default". */
  readonly navMeshId?:
    string;

  /** Raio de separação entre agentes. Padrão 2 × navAgentRadius (mín. 0.5). 0 desliga. */
  readonly separationRadius?:
    number;

  /** Peso da separação. Padrão 1. */
  readonly separationWeight?:
    number;

  /** Mantém o agente sobre a navmesh (altura e bordas). Padrão true. */
  readonly constrainToNavMesh?:
    boolean;

  /** Escreve a posição na entidade do `game.world` a cada tick. Padrão false. */
  readonly syncWorldTransform?:
    boolean;

  /** Move o corpo físico da entidade (kinematic: setNextKinematicTransform; outros: teleporte). Padrão false. */
  readonly syncPhysicsBody?:
    boolean;

  /** Intervalo mínimo (s) para refazer o caminho até uma entidade-alvo que se move. Padrão 0.5. */
  readonly repathInterval?:
    number;

  /** Comportamento próprio (G7). Ausente = árvore padrão (chasing/patrolling/arrived). */
  readonly behavior?:
    BehaviorNodeDefinition;

  /**
   * G73: colide com a geometria FÍSICA (colliders de `game.physics`) por
   * collide-and-slide com uma cápsula (shape-cast) no plano XZ, além da
   * navmesh. `true` = padrões. Padrão desligado (comportamento antigo).
   */
  readonly physicsCollision?:
    boolean | AIAgentPhysicsCollisionConfig;
}

/** Cápsula de colisão do agente (G73). Ignora o próprio corpo e sensores. */
export interface AIAgentPhysicsCollisionConfig {
  /** Raio da cápsula. Padrão `navAgentRadius` (0.25). */
  readonly radius?: number;
  /** Meia-altura do trecho reto da cápsula. Padrão 0.5. */
  readonly halfHeight?: number;
  /**
   * Altura do CENTRO da cápsula acima da posição do agente (pés). Padrão
   * raio + meia-altura + 0.05 (a cápsula não raspa no chão).
   */
  readonly centerHeight?: number;
  /** Folga mantida das superfícies. Padrão 0.02. */
  readonly skin?: number;
  /** Iterações de deslize por tick. Padrão 3. */
  readonly maxIterations?: number;
  /** Filtro de grupos da consulta (ex.: só paredes estáticas). */
  readonly collisionGroups?: { readonly memberships: number; readonly filter: number };
}

/* ============================================================================
 * BEHAVIOR TREES (G7)
 * ========================================================================== */

/** Contexto passado às ações/condições registradas (reutilizado: não guarde). */
export interface BehaviorActionContext {
  readonly agentId: string;
  readonly entityId: string;
  getBlackboard(key: string): BlackboardValue | undefined;
  setBlackboard(key: string, value: BlackboardValue): void;
  /** Posição atual (objeto reutilizado: copie os números). */
  getPosition(): Vector3AI;
  /** Pede caminho e começa a andar. false se não há caminho. */
  moveTo(target: Vector3AI): boolean;
  stop(): void;
  isMoving(): boolean;
  hasArrived(): boolean;
  isTargetSpotted(): boolean;
}

export type BehaviorActionFn = (
  context: BehaviorActionContext,
  deltaSeconds: number,
  params: Readonly<Record<string, unknown>> | undefined,
) => NodeStatus;

export type BehaviorConditionFn = (
  context: BehaviorActionContext,
  params: Readonly<Record<string, unknown>> | undefined,
) => boolean;

/**
 * Definição declarativa de árvore (serializável). Ações/condições por nome
 * vêm de `registerBehaviorAction`/`registerBehaviorCondition`.
 */
export type BehaviorNodeDefinition =
  | { readonly type: "sequence" | "selector"; readonly children: ReadonlyArray<BehaviorNodeDefinition> }
  /** SUCCESS quando `successThreshold` filhos (padrão todos) tiverem sucesso; FAILURE quando não der mais. */
  | { readonly type: "parallel"; readonly children: ReadonlyArray<BehaviorNodeDefinition>; readonly successThreshold?: number }
  | { readonly type: "inverter" | "succeeder" | "failer"; readonly child: BehaviorNodeDefinition }
  /** Repete o filho `count` vezes (-1 = sempre RUNNING). */
  | { readonly type: "repeat"; readonly child: BehaviorNodeDefinition; readonly count?: number }
  | { readonly type: "wait"; readonly seconds: number }
  | { readonly type: "action"; readonly name: string; readonly params?: Readonly<Record<string, unknown>> }
  | { readonly type: "condition"; readonly name: string; readonly params?: Readonly<Record<string, unknown>> }
  /** SUCCESS se a chave existe (e, com `equals`, se é igual). */
  | { readonly type: "blackboard"; readonly key: string; readonly equals?: string | number | boolean | null }
  | { readonly type: "set-blackboard"; readonly key: string; readonly value: string | number | boolean | null }
  /** Anda até `position` ou até o Vector3 em `targetKey`: RUNNING andando, SUCCESS ao chegar, FAILURE sem caminho. */
  | { readonly type: "move-to"; readonly position?: Vector3AI; readonly targetKey?: string }
  | { readonly type: "stop" };

export interface SetAgentPositionOptions {
  /** Refaz o caminho até o alvo atual a partir da nova posição (padrão false = para). */
  readonly keepTarget?: boolean;
}

/* ============================================================================
 * EVENTS
 * ========================================================================== */

export interface PathCalculatedPayload {
  readonly agentId:
    string;

  readonly waypointsCount:
    number;

  readonly success:
    boolean;

  readonly totalDistance:
    number;
}

export const PathCalculatedEvent =
  defineEvent<
    "game.ai.path-calculated",
    PathCalculatedPayload
  >(
    "game.ai.path-calculated",
  );

export interface BehaviorStateChangedPayload {
  readonly agentId:
    string;

  readonly previousState:
    string;

  readonly newState:
    string;
}

export const BehaviorStateChangedEvent =
  defineEvent<
    "game.ai.behavior-changed",
    BehaviorStateChangedPayload
  >(
    "game.ai.behavior-changed",
  );

export interface TargetSpottedPayload {
  readonly agentId:
    string;

  readonly targetEntityId?:
    string;

  readonly position:
    Vector3AI;

  readonly senseType:
    Exclude<
      PerceptionSenseType,
      "none"
    >;
}

export const TargetSpottedEvent =
  defineEvent<
    "game.ai.target-spotted",
    TargetSpottedPayload
  >(
    "game.ai.target-spotted",
  );

export interface AgentArrivedPayload {
  readonly agentId:
    string;

  readonly position:
    Vector3AI;

  readonly targetEntityId?:
    string;
}

/** Emitido UMA vez quando o agente chega ao destino (status fica "arrived" até novo alvo). */
export const AgentArrivedEvent =
  defineEvent<
    "game.ai.agent-arrived",
    AgentArrivedPayload
  >(
    "game.ai.agent-arrived",
  );

export interface StimulusHeardPayload {
  readonly agentId:
    string;

  readonly position:
    Vector3AI;

  readonly loudnessRadius:
    number;

  readonly distance:
    number;

  readonly sourceEntityId?:
    string;
}

/** Um agente ouviu um estímulo (G70). Nada é redirecionado sozinho (ver `investigateStimuli`). */
export const StimulusHeardEvent =
  defineEvent<
    "game.ai.stimulus-heard",
    StimulusHeardPayload
  >(
    "game.ai.stimulus-heard",
  );

/* ============================================================================
 * COMMANDS
 * ========================================================================== */

export interface RequestPathRequest {
  readonly agentId:
    string;

  readonly targetPosition:
    Vector3AI;

  /**
   * true = também move o agente (como `setAgentTarget`). Padrão false: só
   * calcula e emite `path-calculated` (G73).
   */
  readonly move?:
    boolean;
}

export const RequestPathCommand =
  defineCommand<
    "game.ai.request-path",
    RequestPathRequest
  >(
    "game.ai.request-path",
  );

export interface SetAgentTargetRequest {
  readonly agentId:
    string;

  readonly targetEntityId:
    string;
}

export const SetAgentTargetCommand =
  defineCommand<
    "game.ai.set-agent-target",
    SetAgentTargetRequest
  >(
    "game.ai.set-agent-target",
  );

export interface SetBlackboardValueRequest {
  readonly agentId:
    string;

  readonly key:
    string;

  readonly value:
    BlackboardValue;
}

export const SetBlackboardValueCommand =
  defineCommand<
    "game.ai.set-blackboard",
    SetBlackboardValueRequest
  >(
    "game.ai.set-blackboard",
  );

/* ============================================================================
 * ESTADO DE AGENTE (leitura)
 * ========================================================================== */

export interface AIAgentState {
  readonly agentId: string;
  readonly entityId: string;
  readonly position: Vector3AI;
  readonly velocity: Vector3AI;
  readonly forward: Vector3AI;
  /** Seguindo um caminho. */
  readonly moving: boolean;
  /** Chegou ao último destino (até receber outro). */
  readonly arrived: boolean;
  /** Status do blackboard ("chasing", "patrolling", "arrived" ou o da árvore própria). */
  readonly status: string | null;
  readonly targetEntityId?: string;
  readonly navMeshId: string;
  readonly remainingWaypoints: number;
}