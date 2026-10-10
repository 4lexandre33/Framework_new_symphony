import type {
  Plugin,
  PluginContext,
} from "@core";

import type {
  ApplyImpulseRequest,
  CastRayRequest,
  CreateBodyRequest,
  RemoveBodyRequest,
} from "../../contracts/physics/types";

import {
  ApplyImpulseCommand,
  CastRayCommand,
  CollisionEnterEvent,
  CollisionExitEvent,
  ContactForceEvent,
  CreateBodyCommand,
  RemoveBodyCommand,
  TriggerEnterEvent,
  TriggerExitEvent,
} from "../../contracts/physics/types";

import type {
  GameTickPayload,
} from "../../contracts/game-loop/types";

import type {
  PhysicsApi,
} from "../../tokens/physics";

import {
  PhysicsToken,
} from "../../tokens/physics";

import {
  PhysicsService,
} from "../../engine/physics/internal/PhysicsService";

export interface PhysicsPluginService
  extends PhysicsApi {
  initialize():
    Promise<boolean>;

  stepForGameLoop(
    deltaTimeSeconds:
      number,
  ): Promise<void>;

  dispose(): void;
}

export type PhysicsServiceFactory =
  (
    ctx:
      PluginContext,
  ) =>
    PhysicsPluginService;

export const physicsManifest:
  Plugin["manifest"] = {
    id:
      "game.physics",

    name:
      "Deterministic Rapier WASM Physics Plugin",

    version:
      "1.0.0",

    kind:
      "preloaded",

    authority:
      "game",

    permissions: {
      capabilities: [
        PhysicsToken.id,
      ],

      events: [
        "game.physics.collision-enter",
        "game.physics.collision-exit",
        "game.physics.trigger-enter",
        "game.physics.trigger-exit",
        "game.physics.contact-force",
        "game.loop.tick",
      ],
    },

    capabilities: {
      provides: [
        {
          id:
            PhysicsToken.id,

          version:
            "1.0.0",
        },
      ],

      conflicts:
        [],
    },
  };

export function createPhysicsPlugin(
  serviceFactory:
    PhysicsServiceFactory =
      (
        ctx,
      ): PhysicsPluginService =>
        new PhysicsService(
          ctx,
        ),
): Plugin {
  return {
    manifest:
      physicsManifest,

    async setup(
      ctx:
        PluginContext,
    ): Promise<void> {
      const service =
        serviceFactory(
          ctx,
        );

      const initialized =
        await service
          .initialize();

      if (
        !initialized
      ) {
        service.dispose();

        throw new Error(
          "[game.physics] Falha ao inicializar o Rapier WASM.",
        );
      }

      ctx.caps.provide(
        PhysicsToken,
        service,
      );

      ctx.events.define(
        CollisionEnterEvent,
      );

      ctx.events.define(
        CollisionExitEvent,
      );

      ctx.events.define(
        TriggerEnterEvent,
      );

      ctx.events.define(
        TriggerExitEvent,
      );

      ctx.events.define(
        ContactForceEvent,
      );

      ctx.commands.define(
        CreateBodyCommand,
      );

      ctx.commands.define(
        RemoveBodyCommand,
      );

      ctx.commands.define(
        ApplyImpulseCommand,
      );

      ctx.commands.define(
        CastRayCommand,
      );

      const unbindTick =
        ctx.events.on<
          "game.loop.tick",
          GameTickPayload
        >(
          "game.loop.tick",
          async (
            envelope,
          ): Promise<void> => {
            await service
              .stepForGameLoop(
                envelope
                  .payload
                  .deltaSeconds,
              );
          },
        );

      const unbindCreate =
        ctx.commands.handle<
          "game.physics.create-body",
          CreateBodyRequest
        >(
          CreateBodyCommand.type,
          (
            envelope,
          ): boolean =>
            service.createBody(
              envelope
                .payload
                .entityId,
              envelope
                .payload
                .bodyDesc,
              envelope
                .payload
                .colliderDesc,
            ),
        );

      const unbindRemove =
        ctx.commands.handle<
          "game.physics.remove-body",
          RemoveBodyRequest
        >(
          RemoveBodyCommand.type,
          (
            envelope,
          ): boolean =>
            service.removeBody(
              envelope
                .payload
                .entityId,
            ),
        );

      const unbindImpulse =
        ctx.commands.handle<
          "game.physics.apply-impulse",
          ApplyImpulseRequest
        >(
          ApplyImpulseCommand.type,
          (
            envelope,
          ): boolean =>
            service.applyImpulse(
              envelope
                .payload
                .entityId,
              envelope
                .payload
                .impulse,
            ),
        );

      const unbindRay =
        ctx.commands.handle<
          "game.physics.cast-ray",
          CastRayRequest
        >(
          CastRayCommand.type,
          (
            envelope,
          ) =>
            service.castRay(
              envelope
                .payload
                .ray,
            ),
        );

      ctx.lifecycle.onDispose(
        (): void => {
          unbindTick();
          unbindCreate();
          unbindRemove();
          unbindImpulse();
          unbindRay();

          service.dispose();
        },
      );

      ctx.lifecycle.ready();
    },
  };
}
