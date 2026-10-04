import type { Plugin, PluginContext } from "@core";
import { AiToken } from "../../tokens/ai";
import { PhysicsToken } from "../../tokens/physics";
import { WorldToken } from "../../tokens/world";
import type { GameTickPayload } from "../../contracts/game-loop/types";
import { BehaviorStateChangedEvent, PathCalculatedEvent, RequestPathCommand, SetAgentTargetCommand, SetBlackboardValueCommand, TargetSpottedEvent, type RequestPathRequest, type SetAgentTargetRequest, type SetBlackboardValueRequest } from "../../contracts/ai/types";
import { AIService } from "../../engine/ai/internal/AIService";

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
          optional: false,
        },

        {
          id:
            WorldToken.id,

          range:
            "^1.0.0",
          optional: false,
        },
      ],
      conflicts: [],
    },
  };

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