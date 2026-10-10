import type { PluginContext } from "@core";
import { type AiApi } from "../../../tokens/ai";
import { type PhysicsApi } from "../../../tokens/physics";
import { type WorldApi } from "../../../tokens/world";
import {
  AgentArrivedEvent,
  BehaviorStateChangedEvent,
  PathCalculatedEvent,
  StimulusHeardEvent,
  TargetSpottedEvent,
  type AIAgentConfig,
  type AIAgentState,
  type BehaviorActionFn,
  type BehaviorConditionFn,
  type BehaviorNodeDefinition,
  type BlackboardValue,
  type NavMeshGraph,
  type NavMeshPathRequest,
  type NavMeshPathResult,
  type SetAgentPositionOptions,
  type Vector3AI,
} from "../../../contracts/ai/types";
import { AIAgentManager } from "./AIAgentManager";
import { NavMeshQuery, createNavMeshLocation } from "./NavMeshQuery";

const EMPTY_PATH: NavMeshPathResult = Object.freeze({
  found: false,
  waypoints: Object.freeze([]) as ReadonlyArray<Vector3AI>,
  totalDistance: 0,
});

export class AIService
  implements AiApi {
  private readonly agentManager:
    AIAgentManager;

  private physics:
    PhysicsApi | null =
      null;

  private world:
    WorldApi | null =
      null;

  public constructor(
    private readonly ctx:
      PluginContext,
  ) {
    this.agentManager =
      new AIAgentManager({
        onPathCalculated: (agentId, result): void => {
          this.ctx.events.emit(PathCalculatedEvent.type, {
            agentId,
            waypointsCount: result.waypoints.length,
            success: result.found,
            totalDistance: result.totalDistance,
          });
        },

        onBehaviorStateChanged: (agentId, previousState, newState): void => {
          this.ctx.events.emit(BehaviorStateChangedEvent.type, {
            agentId,
            previousState,
            newState,
          });
        },

        onTargetSpotted: (agentId, targetEntityId, position, senseType): void => {
          this.ctx.events.emit(TargetSpottedEvent.type, {
            agentId,
            ...(targetEntityId ? { targetEntityId } : {}),
            position: { x: position.x, y: position.y, z: position.z },
            senseType,
          });
        },

        onArrived: (agentId, position, targetEntityId): void => {
          this.ctx.events.emit(AgentArrivedEvent.type, {
            agentId,
            position: { x: position.x, y: position.y, z: position.z },
            ...(targetEntityId ? { targetEntityId } : {}),
          });
        },

        onStimulusHeard: (agentId, position, loudnessRadius, distance, sourceEntityId): void => {
          this.ctx.events.emit(StimulusHeardEvent.type, {
            agentId,
            position: { x: position.x, y: position.y, z: position.z },
            loudnessRadius,
            distance,
            ...(sourceEntityId ? { sourceEntityId } : {}),
          });
        },
      });
  }

  public bindDependencies(
    physics:
      PhysicsApi | null,
    world:
      WorldApi | null,
  ): void {
    this.physics =
      physics;

    this.world =
      world;
  }

  // ── NavMesh ──────────────────────────────────────────────────────────────

  /** Valida e carrega atomicamente (lança se inválida; a anterior fica). */
  public loadNavMesh(
    graph:
      NavMeshGraph,
    navMeshId?:
      string,
  ): void {
    this.agentManager.navMesh.loadGraph(graph, navMeshId ?? NavMeshQuery.DEFAULT_ID);
  }

  public unloadNavMesh(navMeshId: string): boolean {
    return this.agentManager.navMesh.unload(navMeshId);
  }

  public getNavMeshIds(): string[] {
    return this.agentManager.navMesh.getIds();
  }

  public findPath(
    request:
      NavMeshPathRequest,
  ): NavMeshPathResult {
    return this.agentManager.navMesh.findPath(request);
  }

  /** Ponto mais próximo sobre a navmesh (null se não há navmesh ou passa de `maxDistance`). */
  public projectToNavMesh(point: Vector3AI, navMeshId?: string, maxDistance = Number.POSITIVE_INFINITY): Vector3AI | null {
    const mesh = this.agentManager.navMesh.getMesh(navMeshId ?? NavMeshQuery.DEFAULT_ID);
    const location = createNavMeshLocation();

    if (mesh === null || !mesh.locate(point.x, point.y, point.z, 2, maxDistance, location)) {
      return null;
    }

    return { x: location.x, y: location.y, z: location.z };
  }

  // ── Agentes ──────────────────────────────────────────────────────────────

  public registerAgent(
    config:
      AIAgentConfig,
  ): boolean {
    try {
      return this.registerAgentUnsafe(config);
    } catch (error: unknown) {
      this.ctx.log?.warn?.("game.ai: registerAgent recusado", {
        agentId: config.agentId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private registerAgentUnsafe(config: AIAgentConfig): boolean {
    if (config.initialPosition) {
      return this.agentManager.registerAgent(config);
    }

    // Sem posição inicial: usa a da entidade do world (ou espera ela existir).
    const entityState = this.world?.getEntityState(config.entityId) ?? null;

    if (!entityState) {
      return this.agentManager.registerAgent(config);
    }

    return this.agentManager.registerAgent({
      ...config,
      initialPosition: {
        x: entityState.position.x,
        y: entityState.position.y,
        z: entityState.position.z,
      },
    });
  }

  public unregisterAgent(
    agentId: string,
  ): boolean {
    return this.agentManager.unregisterAgent(agentId);
  }

  public setAgentTarget(
    agentId: string,
    targetPos:
      Vector3AI,
  ): NavMeshPathResult {
    return this.agentManager.setAgentTarget(agentId, targetPos);
  }

  /** Caminho a partir do agente, SEM mover (G73: request-path). */
  public requestAgentPath(agentId: string, targetPos: Vector3AI): NavMeshPathResult {
    if (!this.agentManager.hasAgent(agentId)) {
      return EMPTY_PATH;
    }

    return this.agentManager.queryPath(agentId, targetPos);
  }

  public setAgentTargetEntity(
    agentId: string,
    targetEntityId: string,
  ): boolean {
    const world = this.world;

    if (!world) {
      return false;
    }

    const targetEntity = world.getEntityState(targetEntityId);

    if (!targetEntity) {
      return false;
    }

    return this.agentManager.setAgentTargetEntity(agentId, targetEntityId, {
      x: targetEntity.position.x,
      y: targetEntity.position.y,
      z: targetEntity.position.z,
    });
  }

  public setAgentPosition(agentId: string, position: Vector3AI, options?: SetAgentPositionOptions): boolean {
    return this.agentManager.setAgentPosition(agentId, position, options);
  }

  public stopAgent(agentId: string): boolean {
    return this.agentManager.stopAgent(agentId);
  }

  public getAgentState(agentId: string): AIAgentState | null {
    return this.agentManager.getAgentState(agentId);
  }

  // ── Comportamento (G7) ───────────────────────────────────────────────────

  public registerBehaviorAction(name: string, fn: BehaviorActionFn): boolean {
    return this.agentManager.registerBehaviorAction(name, fn);
  }

  public registerBehaviorCondition(name: string, fn: BehaviorConditionFn): boolean {
    return this.agentManager.registerBehaviorCondition(name, fn);
  }

  public unregisterBehaviorNode(name: string): boolean {
    return this.agentManager.unregisterBehaviorNode(name);
  }

  public setAgentBehavior(agentId: string, definition: BehaviorNodeDefinition | null): boolean {
    try {
      return this.agentManager.setAgentBehavior(agentId, definition);
    } catch (error: unknown) {
      this.ctx.log?.warn?.("game.ai: definição de comportamento inválida", {
        agentId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  public setBlackboardValue(
    agentId: string,
    key: string,
    value:
      BlackboardValue,
  ): void {
    this.agentManager.setBlackboardValue(agentId, key, value);
  }

  public getBlackboardValue(
    agentId: string,
    key: string,
  ): BlackboardValue | undefined {
    return this.agentManager.getBlackboardValue(agentId, key);
  }

  public getAgentPosition(
    agentId: string,
  ): Vector3AI | null {
    return this.agentManager.getAgentPosition(agentId);
  }

  public triggerAudioStimulus(
    position:
      Vector3AI,
    loudnessRadius:
      number,
    sourceEntityId?:
      string,
  ): void {
    this.agentManager.triggerAudioStimulus(position, loudnessRadius, sourceEntityId);
  }

  public update(
    deltaSeconds: number,
  ): void {
    this.agentManager.update(
      deltaSeconds,
      this.physics,
      this.world,
    );
  }

  public clear(): void {
    this.agentManager.clear();

    /*
     * Physics e World pertencem a outros plugins. O teardown da AI
     * deve soltar essas referências para que restart/shutdown não
     * retenha capabilities antigas do Kernel.
     */
    this.physics =
      null;

    this.world =
      null;
  }
}
