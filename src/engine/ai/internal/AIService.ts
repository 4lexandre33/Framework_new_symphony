import type { PluginContext } from "@core";
import { type AiApi } from "../../../tokens/ai";
import { type PhysicsApi } from "../../../tokens/physics";
import { type WorldApi } from "../../../tokens/world";
import { BehaviorStateChangedEvent, PathCalculatedEvent, TargetSpottedEvent, type AIAgentConfig, type BlackboardValue, type NavMeshGraph, type NavMeshPathRequest, type NavMeshPathResult, type Vector3AI } from "../../../contracts/ai/types";
import { AIAgentManager } from "./AIAgentManager";

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
        onPathCalculated: (
          agentId,
          result,
        ): void => {
          this.ctx.events.emit(
            PathCalculatedEvent.type,
            {
              agentId,

              waypointsCount:
                result
                  .waypoints
                  .length,

              success:
                result.found,

              totalDistance:
                result
                  .totalDistance,
            },
          );
        },

        onBehaviorStateChanged: (
          agentId,
          previousState,
          newState,
        ): void => {
          this.ctx.events.emit(
            BehaviorStateChangedEvent.type,
            {
              agentId,
              previousState,
              newState,
            },
          );
        },

        onTargetSpotted: (
          agentId,
          targetEntityId,
          position,
          senseType,
        ): void => {
          this.ctx.events.emit(
            TargetSpottedEvent.type,
            {
              agentId,

              ...(
                targetEntityId
                  ? {
                      targetEntityId,
                    }
                  : {}
              ),

              position: {
                x:
                  position.x,

                y:
                  position.y,

                z:
                  position.z,
              },

              senseType,
            },
          );
        },
      });
  }

  public bindDependencies(
    physics:
      PhysicsApi,
    world:
      WorldApi,
  ): void {
    this.physics =
      physics;

    this.world =
      world;
  }

  public loadNavMesh(
    graph:
      NavMeshGraph,
  ): void {
    this.agentManager
      .navMesh.loadGraph(
        graph,
      );
  }

  public findPath(
    request:
      NavMeshPathRequest,
  ): NavMeshPathResult {
    return this.agentManager
      .navMesh.findPath(
        request,
      );
  }

  public registerAgent(
    config:
      AIAgentConfig,
  ): boolean {
    /*
     * Quando possível, usa a posição real
     * da entidade do ECS como posição inicial
     * do agente.
     */
    if (
      config.initialPosition
    ) {
      return this.agentManager
        .registerAgent(
          config,
        );
    }

    const world =
      this.world;

    if (!world) {
      return this.agentManager
        .registerAgent(
          config,
        );
    }

    const entityState =
      world.getEntityState(
        config.entityId,
      );

    if (!entityState) {
      return this.agentManager
        .registerAgent(
          config,
        );
    }

    return this.agentManager
      .registerAgent({
        ...config,

        initialPosition: {
          x:
            entityState
              .position.x,

          y:
            entityState
              .position.y,

          z:
            entityState
              .position.z,
        },
      });
  }

  public unregisterAgent(
    agentId: string,
  ): boolean {
    return this.agentManager
      .unregisterAgent(
        agentId,
      );
  }

  public setAgentTarget(
    agentId: string,
    targetPos:
      Vector3AI,
  ): NavMeshPathResult {
    return this.agentManager
      .setAgentTarget(
        agentId,
        targetPos,
      );
  }

  public setAgentTargetEntity(
    agentId: string,
    targetEntityId: string,
  ): boolean {
    const world =
      this.world;

    if (!world) {
      return false;
    }

    const targetEntity =
      world.getEntityState(
        targetEntityId,
      );

    if (!targetEntity) {
      return false;
    }

    this.agentManager
      .setBlackboardValue(
        agentId,
        "targetEntityId",
        targetEntityId,
      );

    const result =
      this.agentManager
        .setAgentTarget(
          agentId,
          targetEntity.position,
        );

    return result.found;
  }

  public setBlackboardValue(
    agentId: string,
    key: string,
    value:
      BlackboardValue,
  ): void {
    this.agentManager
      .setBlackboardValue(
        agentId,
        key,
        value,
      );
  }

  public getBlackboardValue(
    agentId: string,
    key: string,
  ): BlackboardValue | undefined {
    return this.agentManager
      .getBlackboardValue(
        agentId,
        key,
      );
  }

  public getAgentPosition(
    agentId: string,
  ): Vector3AI | null {
    return this.agentManager
      .getAgentPosition(
        agentId,
      );
  }

  public triggerAudioStimulus(
    position:
      Vector3AI,
    loudnessRadius:
      number,
    sourceEntityId?:
      string,
  ): void {
    this.agentManager
      .triggerAudioStimulus(
        position,
        loudnessRadius,
        sourceEntityId,
      );
  }

  public update(
    deltaSeconds: number,
  ): void {
    const physics =
      this.physics;

    if (!physics) {
      return;
    }

    this.agentManager.update(
      deltaSeconds,
      physics,
    );
  }

  public clear(): void {
    this.agentManager.clear();
  }
}
