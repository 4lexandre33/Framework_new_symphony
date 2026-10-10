import {
  defineCapability,
} from "@core";

import type {
  AIAgentConfig,
  AIAgentState,
  BehaviorActionFn,
  BehaviorConditionFn,
  BehaviorNodeDefinition,
  BlackboardValue,
  NavMeshGraph,
  NavMeshPathRequest,
  NavMeshPathResult,
  SetAgentPositionOptions,
  Vector3AI,
} from "../contracts/ai/types";

export interface AiApi {
  /**
   * Valida e carrega uma navmesh (atômico: inválida lança e mantém a
   * anterior). `navMeshId` padrão "default"; várias podem coexistir.
   */
  loadNavMesh(
    graph: NavMeshGraph,
    navMeshId?: string,
  ): void;

  /** Caminho suavizado (funnel) com raio, áreas e destino fora da malha preso a ela. */
  findPath(
    request: NavMeshPathRequest,
  ): NavMeshPathResult;

  /** Sem `initialPosition` o agente nasce na posição da entidade do world. */
  registerAgent(
    config: AIAgentConfig,
  ): boolean;

  unregisterAgent(
    agentId: string,
  ): boolean;

  /** Anda até o ponto (deixa de seguir entidade). Sem caminho: para. */
  setAgentTarget(
    agentId: string,
    targetPos: Vector3AI,
  ): NavMeshPathResult;

  /** Persegue a entidade (posição viva; refaz o caminho quando ela anda). Percepção usa este alvo. */
  setAgentTargetEntity(
    agentId: string,
    targetEntityId: string,
  ): boolean;

  setBlackboardValue(
    agentId: string,
    key: string,
    value: BlackboardValue,
  ): void;

  getBlackboardValue(
    agentId: string,
    key: string,
  ): BlackboardValue | undefined;

  getAgentPosition(
    agentId: string,
  ): Vector3AI | null;

  /**
   * Estímulo sonoro: agentes a até `loudnessRadius × hearingSensitivity`
   * gravam `lastHeard*` no blackboard e emitem `game.ai.stimulus-heard`.
   * Ninguém é redirecionado (salvo `investigateStimuli`, e só com caminho).
   */
  triggerAudioStimulus(
    position: Vector3AI,
    loudnessRadius: number,
    sourceEntityId?: string,
  ): void;

  update(
    deltaSeconds: number,
  ): void;

  // ── Adições (G7/G25/G71/G73) ────────────────────────────────────────────

  unloadNavMesh(navMeshId: string): boolean;
  getNavMeshIds(): string[];
  /** Ponto mais próximo sobre a navmesh, ou null. */
  projectToNavMesh(point: Vector3AI, navMeshId?: string, maxDistance?: number): Vector3AI | null;
  /** Calcula o caminho a partir do agente SEM movê-lo (emite path-calculated). */
  requestAgentPath(agentId: string, targetPos: Vector3AI): NavMeshPathResult;
  /** Teleporte (G25). Para o agente, salvo `keepTarget`. */
  setAgentPosition(agentId: string, position: Vector3AI, options?: SetAgentPositionOptions): boolean;
  stopAgent(agentId: string): boolean;
  getAgentState(agentId: string): AIAgentState | null;
  /** Ações/condições usadas por nome em `BehaviorNodeDefinition`. */
  registerBehaviorAction(name: string, fn: BehaviorActionFn): boolean;
  registerBehaviorCondition(name: string, fn: BehaviorConditionFn): boolean;
  unregisterBehaviorNode(name: string): boolean;
  /** Árvore própria do agente (null = padrão). false se inválida (a anterior fica). */
  setAgentBehavior(agentId: string, definition: BehaviorNodeDefinition | null): boolean;
}

export const AiToken =
  defineCapability<AiApi>(
    "game.ai",
    "1.0.0",
  );
