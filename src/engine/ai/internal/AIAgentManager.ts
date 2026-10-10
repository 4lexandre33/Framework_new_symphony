import type {
  AIAgentConfig,
  AIAgentState,
  BehaviorActionContext,
  BehaviorActionFn,
  BehaviorConditionFn,
  BehaviorNodeDefinition,
  BlackboardValue,
  NavMeshPathResult,
  PerceptionSenseType,
  SetAgentPositionOptions,
  Vector3AI,
} from "../../../contracts/ai/types";

import type {
  PhysicsApi,
} from "../../../tokens/physics";

import type {
  WorldApi,
} from "../../../tokens/world";

import {
  NavMeshQuery,
  createNavMeshLocation,
  type NavMeshLocation,
} from "./NavMeshQuery";

import {
  ActionNode,
  BehaviorTree,
  ConditionNode,
  SelectorNode,
  SequenceNode,
  compileBehavior,
  type BTNode,
  type BehaviorRegistry,
} from "./BehaviorTree";

import {
  PerceptionSystem,
} from "./PerceptionSystem";

import {
  SteeringBehaviors,
} from "./SteeringBehaviors";

interface MutableVector3AI {
  x: number;
  y: number;
  z: number;
}

export interface AIAgentManagerHooks {
  onPathCalculated?(agentId: string, result: NavMeshPathResult): void;
  onBehaviorStateChanged?(agentId: string, previousState: string, newState: string): void;
  onTargetSpotted?(
    agentId: string,
    targetEntityId: string | undefined,
    position: Vector3AI,
    senseType: Exclude<PerceptionSenseType, "none">,
  ): void;
  onArrived?(agentId: string, position: Vector3AI, targetEntityId: string | undefined): void;
  onStimulusHeard?(
    agentId: string,
    position: Vector3AI,
    loudnessRadius: number,
    distance: number,
    sourceEntityId: string | undefined,
  ): void;
}

class ActiveAIAgent {
  public readonly position: MutableVector3AI;
  public readonly velocity: MutableVector3AI = { x: 0, y: 0, z: 0 };
  public readonly forwardDir: MutableVector3AI;
  public readonly targetPos: MutableVector3AI = { x: 0, y: 0, z: 0 };
  public readonly lastPathTarget: MutableVector3AI = { x: Number.NaN, y: Number.NaN, z: Number.NaN };
  public readonly separation: MutableVector3AI = { x: 0, y: 0, z: 0 };
  public readonly location: NavMeshLocation = createNavMeshLocation();
  /** Patches reutilizados (sem alocação por tick). */
  public readonly worldPatch: { readonly position: MutableVector3AI };
  public readonly kinematicTarget: { readonly position: MutableVector3AI };
  public readonly behaviorTree: BehaviorTree;
  public readonly context: AgentBehaviorContext;
  public waypoints: ReadonlyArray<Vector3AI> = EMPTY_WAYPOINTS;
  public waypointIndex = 0;
  public moving = false;
  public arrived = false;
  public targetSpotted = false;
  public targetEntityId: string | undefined = undefined;
  public hasTargetPos = false;
  public repathTimer = 0;
  public positionPending: boolean;
  public polygonHint = -1;
  public navMeshId: string;

  public constructor(
    public readonly config: AIAgentConfig,
    manager: AIAgentManager,
    defaultRoot: (agent: ActiveAIAgent) => BTNode,
  ) {
    const initial = config.initialPosition;
    this.position = { x: initial?.x ?? 0, y: initial?.y ?? 0, z: initial?.z ?? 0 };
    this.positionPending = initial === undefined;
    this.forwardDir = normalizeOr(config.initialForwardDirection, 0, 0, 1);
    this.worldPatch = { position: this.position };
    this.kinematicTarget = { position: this.position };
    this.navMeshId = config.navMeshId ?? NavMeshQuery.DEFAULT_ID;
    this.context = new AgentBehaviorContext(manager, this);
    this.behaviorTree = new BehaviorTree(defaultRoot(this));
  }
}

/** Contexto exposto às ações/condições registradas (um por agente, reutilizado). */
class AgentBehaviorContext implements BehaviorActionContext {
  public constructor(
    private readonly manager: AIAgentManager,
    private readonly agent: ActiveAIAgent,
  ) {}

  public get agentId(): string {
    return this.agent.config.agentId;
  }

  public get entityId(): string {
    return this.agent.config.entityId;
  }

  public getBlackboard(key: string): BlackboardValue | undefined {
    return this.agent.behaviorTree.memory.get(key);
  }

  public setBlackboard(key: string, value: BlackboardValue): void {
    this.agent.behaviorTree.memory.set(key, value);
  }

  public getPosition(): Vector3AI {
    return this.agent.position;
  }

  public moveTo(target: Vector3AI): boolean {
    return this.manager.setAgentTarget(this.agent.config.agentId, target).found;
  }

  public stop(): void {
    this.manager.stopAgent(this.agent.config.agentId);
  }

  public isMoving(): boolean {
    return this.agent.moving;
  }

  public hasArrived(): boolean {
    return this.agent.arrived;
  }

  public isTargetSpotted(): boolean {
    return this.agent.targetSpotted;
  }
}

const EMPTY_WAYPOINTS: ReadonlyArray<Vector3AI> = Object.freeze([]);

function normalizeOr(source: Vector3AI | undefined, fx: number, fy: number, fz: number): MutableVector3AI {
  if (source && Number.isFinite(source.x) && Number.isFinite(source.y) && Number.isFinite(source.z)) {
    const length = Math.sqrt(source.x * source.x + source.y * source.y + source.z * source.z);

    if (length > 0.000001) {
      return { x: source.x / length, y: source.y / length, z: source.z / length };
    }
  }

  return { x: fx, y: fy, z: fz };
}

export class AIAgentManager implements BehaviorRegistry {
  private readonly agents = new Map<string, ActiveAIAgent>();
  /** Lista paralela para laços sem iterador (hot path). */
  private readonly agentList: ActiveAIAgent[] = [];
  private readonly navMeshQuery = new NavMeshQuery();
  private readonly perceptionSystem = new PerceptionSystem();
  private readonly steering = new SteeringBehaviors();
  private readonly actions = new Map<string, BehaviorActionFn>();
  private readonly conditions = new Map<string, BehaviorConditionFn>();
  private readonly scratchForce: MutableVector3AI = { x: 0, y: 0, z: 0 };
  private elapsedSeconds = 0;

  private readonly createDefaultRoot = (agent: ActiveAIAgent): BTNode =>
    new SelectorNode([
      new SequenceNode([
        new ConditionNode((blackboard): boolean => blackboard.get("arrived") === true),
        new ActionNode((blackboard) => {
          blackboard.set("status", "arrived");
          return "SUCCESS";
        }),
      ]),
      new SequenceNode([
        new ConditionNode((blackboard): boolean => blackboard.get("hasTarget") === true),
        new ActionNode((blackboard) => {
          if (this.isVector3(blackboard.get("targetPos")) || agent.targetEntityId !== undefined) {
            blackboard.set("status", "chasing");
            return "SUCCESS";
          }

          return "FAILURE";
        }),
      ]),
      new ActionNode((blackboard) => {
        blackboard.set("status", "patrolling");
        return "SUCCESS";
      }),
    ]);

  public constructor(private readonly hooks: AIAgentManagerHooks = {}) {}

  public get navMesh(): NavMeshQuery {
    return this.navMeshQuery;
  }

  // ── Registro de comportamento (G7) ───────────────────────────────────────

  public registerBehaviorAction(name: string, fn: BehaviorActionFn): boolean {
    if (typeof name !== "string" || name.length === 0 || typeof fn !== "function") {
      return false;
    }

    this.actions.set(name, fn);
    return true;
  }

  public registerBehaviorCondition(name: string, fn: BehaviorConditionFn): boolean {
    if (typeof name !== "string" || name.length === 0 || typeof fn !== "function") {
      return false;
    }

    this.conditions.set(name, fn);
    return true;
  }

  public unregisterBehaviorNode(name: string): boolean {
    const removedAction = this.actions.delete(name);
    const removedCondition = this.conditions.delete(name);
    return removedAction || removedCondition;
  }

  public getAction(name: string): BehaviorActionFn | undefined {
    return this.actions.get(name);
  }

  public getCondition(name: string): BehaviorConditionFn | undefined {
    return this.conditions.get(name);
  }

  /** Árvore própria do agente (null = padrão). Lança se a definição for inválida. */
  public setAgentBehavior(agentId: string, definition: BehaviorNodeDefinition | null): boolean {
    const agent = this.agents.get(agentId);

    if (!agent) {
      return false;
    }

    const root = definition === null ? this.createDefaultRoot(agent) : compileBehavior(definition, agent.context, this);
    agent.behaviorTree.setRoot(root);
    return true;
  }

  // ── Agentes ──────────────────────────────────────────────────────────────

  public registerAgent(config: AIAgentConfig): boolean {
    if (typeof config.agentId !== "string" || config.agentId.length === 0 || this.agents.has(config.agentId)) {
      return false;
    }

    const agent = new ActiveAIAgent(config, this, this.createDefaultRoot);

    if (config.behavior) {
      // Valida antes de registrar (lança em definição inválida).
      agent.behaviorTree.setRoot(compileBehavior(config.behavior, agent.context, this));
    }

    this.agents.set(config.agentId, agent);
    this.agentList.push(agent);

    if (!agent.positionPending) {
      this.constrain(agent);
    }

    return true;
  }

  public unregisterAgent(agentId: string): boolean {
    const agent = this.agents.get(agentId);

    if (!agent) {
      return false;
    }

    this.agents.delete(agentId);
    const index = this.agentList.indexOf(agent);

    if (index >= 0) {
      this.agentList.splice(index, 1);
    }

    return true;
  }

  public hasAgent(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  /** Destino por posição: calcula caminho e anda. Deixa de seguir entidade. */
  public setAgentTarget(agentId: string, targetPos: Vector3AI): NavMeshPathResult {
    const agent = this.agents.get(agentId);

    if (!agent) {
      return { found: false, waypoints: EMPTY_WAYPOINTS, totalDistance: 0 };
    }

    agent.targetEntityId = undefined;
    agent.behaviorTree.memory.set("targetEntityId", null);
    return this.pathTo(agent, targetPos, true);
  }

  /** Persegue uma entidade (posição viva do world; refaz o caminho quando ela anda). */
  public setAgentTargetEntity(agentId: string, targetEntityId: string, position: Vector3AI): boolean {
    const agent = this.agents.get(agentId);

    if (!agent) {
      return false;
    }

    agent.targetEntityId = targetEntityId;
    agent.behaviorTree.memory.set("targetEntityId", targetEntityId);
    agent.repathTimer = 0;
    return this.pathTo(agent, position, true).found;
  }

  /** Só calcula o caminho a partir do agente (não move). */
  public queryPath(agentId: string, targetPos: Vector3AI): NavMeshPathResult {
    const agent = this.agents.get(agentId);

    if (!agent) {
      return { found: false, waypoints: EMPTY_WAYPOINTS, totalDistance: 0 };
    }

    const result = this.computePath(agent, targetPos);
    this.hooks.onPathCalculated?.(agentId, result);
    return result;
  }

  /** G25: teleporte. Para o agente (ou refaz o caminho com `keepTarget`). */
  public setAgentPosition(agentId: string, position: Vector3AI, options?: SetAgentPositionOptions): boolean {
    const agent = this.agents.get(agentId);

    if (!agent || !Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)) {
      return false;
    }

    agent.position.x = position.x;
    agent.position.y = position.y;
    agent.position.z = position.z;
    agent.velocity.x = 0;
    agent.velocity.y = 0;
    agent.velocity.z = 0;
    agent.positionPending = false;
    agent.polygonHint = -1;
    this.constrain(agent);

    if (options?.keepTarget === true && (agent.moving || agent.targetEntityId !== undefined) && agent.hasTargetPos) {
      this.pathTo(agent, agent.targetPos, false);
    } else {
      this.stopAgent(agentId);
    }

    return true;
  }

  public stopAgent(agentId: string): boolean {
    const agent = this.agents.get(agentId);

    if (!agent) {
      return false;
    }

    agent.waypoints = EMPTY_WAYPOINTS;
    agent.waypointIndex = 0;
    agent.moving = false;
    agent.arrived = false;
    agent.velocity.x = 0;
    agent.velocity.y = 0;
    agent.velocity.z = 0;
    agent.targetEntityId = undefined;
    agent.hasTargetPos = false;
    const memory = agent.behaviorTree.memory;
    memory.set("hasTarget", false);
    memory.set("targetPos", null);
    memory.set("arrived", false);
    memory.set("targetEntityId", null);
    agent.targetSpotted = false;
    return true;
  }

  public setBlackboardValue(agentId: string, key: string, value: BlackboardValue): void {
    this.agents.get(agentId)?.behaviorTree.memory.set(key, value);
  }

  public getBlackboardValue(agentId: string, key: string): BlackboardValue | undefined {
    return this.agents.get(agentId)?.behaviorTree.memory.get(key);
  }

  public getAgentPosition(agentId: string): Vector3AI | null {
    const position = this.agents.get(agentId)?.position;
    return position ? { x: position.x, y: position.y, z: position.z } : null;
  }

  public getAgentState(agentId: string): AIAgentState | null {
    const agent = this.agents.get(agentId);

    if (!agent) {
      return null;
    }

    const status = agent.behaviorTree.memory.get("status");

    return {
      agentId: agent.config.agentId,
      entityId: agent.config.entityId,
      position: { x: agent.position.x, y: agent.position.y, z: agent.position.z },
      velocity: { x: agent.velocity.x, y: agent.velocity.y, z: agent.velocity.z },
      forward: { x: agent.forwardDir.x, y: agent.forwardDir.y, z: agent.forwardDir.z },
      moving: agent.moving,
      arrived: agent.arrived,
      status: typeof status === "string" ? status : null,
      ...(agent.targetEntityId !== undefined ? { targetEntityId: agent.targetEntityId } : {}),
      navMeshId: agent.navMeshId,
      remainingWaypoints: Math.max(0, agent.waypoints.length - agent.waypointIndex),
    };
  }

  /**
   * G70: estímulo sonoro real. Ouve quem está a até `loudnessRadius ×
   * hearingSensitivity`. Grava `lastHeard*` no blackboard e avisa; só anda
   * se `investigateStimuli` e houver caminho (nunca cancela o alvo atual).
   */
  public triggerAudioStimulus(position: Vector3AI, loudnessRadius: number, sourceEntityId?: string): number {
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)) {
      return 0;
    }

    const radius = this.sanitizeNonNegative(loudnessRadius);
    let heard = 0;

    for (const agent of this.agentList) {
      if (sourceEntityId !== undefined && sourceEntityId === agent.config.entityId) {
        continue;
      }

      const perception = agent.config.perceptionConfig;
      const sensitivity = this.sanitizeNonNegative(perception?.hearingSensitivity ?? 1);
      const reach = radius * sensitivity;
      const dx = position.x - agent.position.x;
      const dy = position.y - agent.position.y;
      const dz = position.z - agent.position.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (sensitivity <= 0 || distance > reach) {
        continue;
      }

      heard += 1;
      const memory = agent.behaviorTree.memory;
      memory.set("lastHeardPosition", { x: position.x, y: position.y, z: position.z });
      memory.set("lastHeardSourceEntityId", sourceEntityId ?? null);
      memory.set("lastHeardTime", this.elapsedSeconds);
      this.hooks.onStimulusHeard?.(agent.config.agentId, position, radius, distance, sourceEntityId);

      if (perception?.investigateStimuli === true) {
        const result = this.computePath(agent, position);

        if (result.found) {
          agent.targetEntityId = undefined;
          this.applyPath(agent, position, result);
          this.hooks.onPathCalculated?.(agent.config.agentId, result);
        }
      }
    }

    return heard;
  }

  public update(
    deltaSeconds: number,
    physics: PhysicsApi | null = null,
    world: WorldApi | null = null,
  ): void {
    const safeDelta = this.sanitizeDelta(deltaSeconds);

    if (safeDelta <= 0) {
      return;
    }

    this.elapsedSeconds += safeDelta;
    const list = this.agentList;

    for (let index = 0; index < list.length; index += 1) {
      this.updateAgent(list[index] as ActiveAIAgent, safeDelta, physics, world);
    }
  }

  public clear(): void {
    this.agents.clear();
    this.agentList.length = 0;
    this.navMeshQuery.clear();
  }

  // ── Internos ─────────────────────────────────────────────────────────────

  private updateAgent(agent: ActiveAIAgent, deltaSeconds: number, physics: PhysicsApi | null, world: WorldApi | null): void {
    this.resolvePendingPosition(agent, world);
    this.refreshEntityTarget(agent, deltaSeconds, world);
    this.tickBehavior(agent, deltaSeconds);
    this.updatePerception(agent, physics);
    this.updateLocomotion(agent, deltaSeconds);
    this.syncTransforms(agent, physics, world);
  }

  /** G73: sem `initialPosition`, nasce na posição da entidade do world assim que ela existir. */
  private resolvePendingPosition(agent: ActiveAIAgent, world: WorldApi | null): void {
    if (!agent.positionPending || world === null) {
      return;
    }

    const state = world.getEntityState(agent.config.entityId);

    if (!state) {
      return;
    }

    agent.position.x = state.position.x;
    agent.position.y = state.position.y;
    agent.position.z = state.position.z;
    agent.positionPending = false;
    this.constrain(agent);
  }

  private refreshEntityTarget(agent: ActiveAIAgent, deltaSeconds: number, world: WorldApi | null): void {
    const targetId = agent.targetEntityId;

    if (targetId === undefined || world === null) {
      return;
    }

    const state = world.getEntityState(targetId);

    if (!state) {
      return;
    }

    agent.targetPos.x = state.position.x;
    agent.targetPos.y = state.position.y;
    agent.targetPos.z = state.position.z;
    agent.hasTargetPos = true;
    agent.repathTimer += deltaSeconds;
    const interval = this.sanitizeNonNegative(agent.config.repathInterval ?? 0.5);
    const threshold = Math.max(0.5, this.sanitizeNonNegative(agent.config.stoppingDistance ?? 1));
    const dx = agent.targetPos.x - agent.lastPathTarget.x;
    const dy = agent.targetPos.y - agent.lastPathTarget.y;
    const dz = agent.targetPos.z - agent.lastPathTarget.z;

    if (agent.repathTimer >= interval && !(dx * dx + dy * dy + dz * dz <= threshold * threshold)) {
      agent.repathTimer = 0;
      this.pathTo(agent, agent.targetPos, false);
    }
  }

  private tickBehavior(agent: ActiveAIAgent, deltaSeconds: number): void {
    const memory = agent.behaviorTree.memory;
    const previousStatus = this.readString(memory.get("status")) ?? "none";
    agent.behaviorTree.tick(deltaSeconds);
    const currentStatus = this.readString(memory.get("status")) ?? "none";

    if (currentStatus !== previousStatus) {
      this.hooks.onBehaviorStateChanged?.(agent.config.agentId, previousStatus, currentStatus);
    }
  }

  /** Percepção só do ALVO-ENTIDADE (G70: destino comum não é "alvo"). */
  private updatePerception(agent: ActiveAIAgent, physics: PhysicsApi | null): void {
    const config = agent.config.perceptionConfig;

    if (agent.targetEntityId === undefined || !agent.hasTargetPos || !config) {
      if (agent.targetSpotted) {
        agent.targetSpotted = false;
        agent.behaviorTree.memory.set("targetSpotted", false);
      }

      return;
    }

    const result = this.perceptionSystem.checkPerception(
      agent.position,
      agent.forwardDir,
      agent.targetPos,
      config,
      physics,
      agent.config.entityId,
      agent.targetEntityId,
    );

    agent.behaviorTree.memory.set("targetSpotted", result.targetSpotted);

    // Só na borda false -> true.
    if (result.targetSpotted && !agent.targetSpotted && result.senseType !== "none") {
      this.hooks.onTargetSpotted?.(agent.config.agentId, agent.targetEntityId, agent.targetPos, result.senseType);
    }

    agent.targetSpotted = result.targetSpotted;
  }

  private updateLocomotion(agent: ActiveAIAgent, deltaSeconds: number): void {
    if (agent.positionPending) {
      return;
    }

    this.computeSeparation(agent);
    const separation = agent.separation;

    if (!agent.moving) {
      // Parado: só a separação empurra (sem inércia).
      if (separation.x !== 0 || separation.z !== 0 || separation.y !== 0) {
        agent.position.x += separation.x * deltaSeconds;
        agent.position.y += separation.y * deltaSeconds;
        agent.position.z += separation.z * deltaSeconds;
        this.constrain(agent);
      }

      return;
    }

    const stoppingDistance = Math.max(0.01, this.sanitizeNonNegative(agent.config.stoppingDistance ?? 1));
    const waypoints = agent.waypoints;
    const lastIndex = waypoints.length - 1;

    // Pula waypoints intermediários já alcançados.
    while (agent.waypointIndex < lastIndex) {
      const waypoint = waypoints[agent.waypointIndex] as Vector3AI;
      const dx = waypoint.x - agent.position.x;
      const dz = waypoint.z - agent.position.z;

      if (dx * dx + dz * dz > Math.min(stoppingDistance, 0.5) * Math.min(stoppingDistance, 0.5)) {
        break;
      }

      agent.waypointIndex += 1;
    }

    const waypoint = waypoints[agent.waypointIndex];

    if (!waypoint) {
      this.completePath(agent);
      return;
    }

    const isLast = agent.waypointIndex >= lastIndex;
    const dx = waypoint.x - agent.position.x;
    const dy = waypoint.y - agent.position.y;
    const dz = waypoint.z - agent.position.z;

    if (isLast && dx * dx + dy * dy + dz * dz <= stoppingDistance * stoppingDistance) {
      this.completePath(agent);
      return;
    }

    const maxSpeed = this.sanitizeNonNegative(agent.config.maxSpeed ?? 5);
    const maxForce = this.sanitizeNonNegative(agent.config.maxForce ?? 10);
    const force = isLast
      ? this.steering.arrive(agent.position, agent.velocity, waypoint, maxSpeed, maxForce, Math.max(stoppingDistance * 2, 0.01))
      : this.steering.seek(agent.position, agent.velocity, waypoint, maxSpeed, maxForce);
    this.scratchForce.x = force.x + separation.x;
    this.scratchForce.y = force.y + separation.y;
    this.scratchForce.z = force.z + separation.z;
    agent.velocity.x += this.scratchForce.x * deltaSeconds;
    agent.velocity.y += this.scratchForce.y * deltaSeconds;
    agent.velocity.z += this.scratchForce.z * deltaSeconds;
    this.clampVectorLength(agent.velocity, maxSpeed);
    agent.position.x += agent.velocity.x * deltaSeconds;
    agent.position.y += agent.velocity.y * deltaSeconds;
    agent.position.z += agent.velocity.z * deltaSeconds;
    this.constrain(agent);

    const speedSq = agent.velocity.x * agent.velocity.x + agent.velocity.z * agent.velocity.z;

    if (speedSq > 0.00000001) {
      const inverse = 1 / Math.sqrt(speedSq + agent.velocity.y * agent.velocity.y);
      agent.forwardDir.x = agent.velocity.x * inverse;
      agent.forwardDir.y = agent.velocity.y * inverse;
      agent.forwardDir.z = agent.velocity.z * inverse;
    }
  }

  /** Separação entre agentes da mesma navmesh (G73). Escreve em `agent.separation`. */
  private computeSeparation(agent: ActiveAIAgent): void {
    const separation = agent.separation;
    separation.x = 0;
    separation.y = 0;
    separation.z = 0;
    const weight = this.sanitizeNonNegative(agent.config.separationWeight ?? 1);
    const radius = this.sanitizeNonNegative(
      agent.config.separationRadius ?? Math.max(0.5, (agent.config.navAgentRadius ?? 0.25) * 2),
    );

    if (weight <= 0 || radius <= 0) {
      return;
    }

    const list = this.agentList;
    const radiusSq = radius * radius;

    for (let index = 0; index < list.length; index += 1) {
      const other = list[index] as ActiveAIAgent;

      if (other === agent || other.positionPending || other.navMeshId !== agent.navMeshId) {
        continue;
      }

      let dx = agent.position.x - other.position.x;
      const dy = agent.position.y - other.position.y;
      let dz = agent.position.z - other.position.z;
      const distanceSq = dx * dx + dz * dz;

      if (distanceSq >= radiusSq || Math.abs(dy) > radius * 2) {
        continue;
      }

      let distance = Math.sqrt(distanceSq);

      if (distance < 0.0001) {
        // Coincidentes: direção determinística pela ordem na lista.
        dx = index % 2 === 0 ? 1 : -1;
        dz = index % 3 === 0 ? 0.5 : -0.5;
        distance = 0.0001;
      }

      const strength = (1 - distance / radius) / distance;
      separation.x += dx * strength;
      separation.z += dz * strength;
    }

    const maxSpeed = this.sanitizeNonNegative(agent.config.maxSpeed ?? 5);
    separation.x *= weight * maxSpeed;
    separation.z *= weight * maxSpeed;
    this.clampVectorLength(separation, maxSpeed);
  }

  /** Mantém o agente sobre a navmesh: altura do polígono e bordas (sem atravessar paredes). */
  private constrain(agent: ActiveAIAgent): void {
    if (agent.config.constrainToNavMesh === false) {
      return;
    }

    const mesh = this.navMeshQuery.getMesh(agent.navMeshId);

    if (mesh === null || mesh.size === 0) {
      return;
    }

    const location = agent.location;

    if (mesh.locate(agent.position.x, agent.position.y, agent.position.z, 2, Number.POSITIVE_INFINITY, location, agent.polygonHint)) {
      agent.position.x = location.x;
      agent.position.y = location.y;
      agent.position.z = location.z;
      agent.polygonHint = location.polygon;
    }
  }

  private syncTransforms(agent: ActiveAIAgent, physics: PhysicsApi | null, world: WorldApi | null): void {
    if (agent.positionPending) {
      return;
    }

    if (agent.config.syncWorldTransform === true && world !== null) {
      world.updateEntityTransform(agent.config.entityId, agent.worldPatch);
    }

    if (agent.config.syncPhysicsBody === true && physics !== null) {
      if (!physics.setNextKinematicTransform(agent.config.entityId, agent.kinematicTarget)) {
        physics.setBodyTranslation(agent.config.entityId, agent.position, true);
      }
    }
  }

  private computePath(agent: ActiveAIAgent, target: Vector3AI): NavMeshPathResult {
    return this.navMeshQuery.findPath({
      start: agent.position,
      target,
      ...(agent.config.navAgentRadius !== undefined ? { agentRadius: agent.config.navAgentRadius } : {}),
      navMeshId: agent.navMeshId,
    });
  }

  /** Calcula, aplica (ou limpa) e emite path-calculated. */
  private pathTo(agent: ActiveAIAgent, target: Vector3AI, clearOnFailure: boolean): NavMeshPathResult {
    const result = this.computePath(agent, target);

    if (result.found) {
      this.applyPath(agent, target, result);
    } else if (clearOnFailure) {
      this.clearPath(agent);
    }

    this.hooks.onPathCalculated?.(agent.config.agentId, result);
    return result;
  }

  private applyPath(agent: ActiveAIAgent, target: Vector3AI, result: NavMeshPathResult): void {
    agent.waypoints = result.waypoints;
    // waypoints[0] é a posição atual.
    agent.waypointIndex = result.waypoints.length > 1 ? 1 : 0;
    agent.moving = true;
    agent.arrived = false;
    agent.lastPathTarget.x = target.x;
    agent.lastPathTarget.y = target.y;
    agent.lastPathTarget.z = target.z;

    if (target !== agent.targetPos) {
      agent.targetPos.x = target.x;
      agent.targetPos.y = target.y;
      agent.targetPos.z = target.z;
    }

    agent.hasTargetPos = true;
    const memory = agent.behaviorTree.memory;
    memory.set("hasTarget", true);
    memory.set("arrived", false);
    memory.set("targetPos", { x: target.x, y: target.y, z: target.z });
  }

  private clearPath(agent: ActiveAIAgent): void {
    agent.waypoints = EMPTY_WAYPOINTS;
    agent.waypointIndex = 0;
    agent.moving = false;
    agent.hasTargetPos = agent.targetEntityId !== undefined && agent.hasTargetPos;
    const memory = agent.behaviorTree.memory;
    memory.set("hasTarget", false);
    memory.set("targetPos", null);
    agent.targetSpotted = false;
  }

  /** Chegou: estado "arrived" persiste até novo destino e o evento sai UMA vez (G73). */
  private completePath(agent: ActiveAIAgent): void {
    agent.waypoints = EMPTY_WAYPOINTS;
    agent.waypointIndex = 0;
    agent.velocity.x = 0;
    agent.velocity.y = 0;
    agent.velocity.z = 0;
    agent.moving = false;
    const memory = agent.behaviorTree.memory;
    memory.set("hasTarget", false);
    memory.set("targetPos", null);

    if (!agent.arrived) {
      agent.arrived = true;
      memory.set("arrived", true);
      this.hooks.onArrived?.(agent.config.agentId, agent.position, agent.targetEntityId);
    }
  }

  private isVector3(value: BlackboardValue | undefined): value is Vector3AI {
    if (typeof value !== "object" || value === null) {
      return false;
    }

    const candidate = value as Partial<Vector3AI>;
    return Number.isFinite(candidate.x) && Number.isFinite(candidate.y) && Number.isFinite(candidate.z);
  }

  private readString(value: BlackboardValue | undefined): string | undefined {
    return typeof value === "string" ? value : undefined;
  }

  private clampVectorLength(vector: MutableVector3AI, maximumLength: number): void {
    if (maximumLength <= 0) {
      vector.x = 0;
      vector.y = 0;
      vector.z = 0;
      return;
    }

    const lengthSquared = vector.x * vector.x + vector.y * vector.y + vector.z * vector.z;

    if (lengthSquared <= maximumLength * maximumLength) {
      return;
    }

    const scale = maximumLength / Math.sqrt(lengthSquared);
    vector.x *= scale;
    vector.y *= scale;
    vector.z *= scale;
  }

  private sanitizeDelta(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }

    // IA não tenta recuperar segundos inteiros de uma vez após breakpoint/stall.
    return Math.max(0, Math.min(value, 0.1));
  }

  private sanitizeNonNegative(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }

    return Math.max(0, value);
  }
}
