import type {
  Plugin,
  PluginContext,
} from "../../core/contracts/plugin-context";

import {
  AiToken,
  type AiApi,
} from "../../tokens/ai";

import {
  PhysicsToken,
  type PhysicsApi,
} from "../../tokens/physics";

import {
  WorldToken,
  type WorldApi,
} from "../../tokens/world";

import type {
  GameTickPayload,
} from "../../contracts/game-loop/types";

import {
  BehaviorStateChangedEvent,
  PathCalculatedEvent,
  RequestPathCommand,
  SetAgentTargetCommand,
  SetBlackboardValueCommand,
  TargetSpottedEvent,
  type AIAgentConfig,
  type BlackboardValue,
  type NavMeshGraph,
  type NavMeshPathRequest,
  type NavMeshPathResult,
  type RequestPathRequest,
  type SetAgentTargetRequest,
  type SetBlackboardValueRequest,
  type Vector3AI,
} from "../../contracts/ai/types";

import {
  AIAgentManager,
} from "../../engine/ai/AIAgentManager";

export const aiManifest:
  Plugin["manifest"] = {
    id:
      "game.ai",

    name:
      "3D NavMesh Pathfinding & Behavior Tree AI Plugin",

    version:
      "1.0.0",

    kind:
      "preloaded",

    authority:
      "game",

    dependsOn: [
      {
        id:
          "game.loop",

        range:
          "^1.0.0",
      },

      {
        id:
          "game.physics",

        range:
          "^1.0.0",
      },

      {
        id:
          "game.world",

        range:
          "^1.0.0",
      },
    ],

    permissions: {
      capabilities: [
        AiToken.id,
        PhysicsToken.id,
        WorldToken.id,
      ],

      events: [
        "game.ai.path-calculated",
        "game.ai.behavior-changed",
        "game.ai.target-spotted",
        "game.loop.tick",
      ],
    },

    capabilities: {
      provides: [
        {
          id:
            AiToken.id,

          version:
            "1.0.0",
        },
      ],

      consumes: [
        {
          id:
            PhysicsToken.id,

          range:
            "^1.0.0",
        },

        {
          id:
            WorldToken.id,

          range:
            "^1.0.0",
        },
      ],
    },
  };

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

export function createAIPlugin():
  Plugin {
  let aiService:
    AIService | null =
      null;

  const manifest:
    Plugin["manifest"] = {
      ...aiManifest,

      lifecycleHooks: {
        ...aiManifest.lifecycleHooks,

        onBoot(
          ctx:
            PluginContext,
        ): void {
          if (!aiService) {
            throw new Error(
              "AIService não foi criado durante setup().",
            );
          }

          const physics =
            ctx.caps.require(
              PhysicsToken,
            );

          const world =
            ctx.caps.require(
              WorldToken,
            );

          aiService
            .bindDependencies(
              physics,
              world,
            );
        },
      },
    };

  return {
    manifest,

    setup(
      ctx:
        PluginContext,
    ): void {
      const service =
        new AIService(
          ctx,
        );

      aiService =
        service;

      ctx.caps.provide(
        AiToken,
        service,
      );

      ctx.events.define(
        PathCalculatedEvent,
      );

      ctx.events.define(
        BehaviorStateChangedEvent,
      );

      ctx.events.define(
        TargetSpottedEvent,
      );

      ctx.commands.define(
        RequestPathCommand,
      );

      ctx.commands.define(
        SetAgentTargetCommand,
      );

      ctx.commands.define(
        SetBlackboardValueCommand,
      );

      const unbindTick =
        ctx.events.on(
          "game.loop.tick",
          (
            envelope,
          ): void => {
            const payload =
              envelope.payload as
                GameTickPayload;

            service.update(
              payload.deltaSeconds,
            );
          },
        );

      const unbindRequestPath =
        ctx.commands.handle(
          RequestPathCommand.type,
          (
            envelope,
          ) => {
            const payload =
              envelope.payload as
                RequestPathRequest;

            return service
              .setAgentTarget(
                payload.agentId,
                payload.targetPosition,
              );
          },
        );

      const unbindSetTarget =
        ctx.commands.handle(
          SetAgentTargetCommand.type,
          (
            envelope,
          ) => {
            const payload =
              envelope.payload as
                SetAgentTargetRequest;

            return service
              .setAgentTargetEntity(
                payload.agentId,
                payload.targetEntityId,
              );
          },
        );

      const unbindSetBlackboard =
        ctx.commands.handle(
          SetBlackboardValueCommand.type,
          (
            envelope,
          ): void => {
            const payload =
              envelope.payload as
                SetBlackboardValueRequest;

            service
              .setBlackboardValue(
                payload.agentId,
                payload.key,
                payload.value,
              );
          },
        );

      ctx.lifecycle.onDispose(
        (): void => {
          unbindTick();
          unbindRequestPath();
          unbindSetTarget();
          unbindSetBlackboard();

          service.clear();

          if (
            aiService ===
            service
          ) {
            aiService =
              null;
          }
        },
      );

      ctx.lifecycle.ready();
    },
  };
}
