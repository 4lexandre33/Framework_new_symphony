import type { Plugin, PluginContext } from "@core";
import { PhysicsToken } from "../../tokens/physics";
import { ApplyImpulseCommand, CastRayCommand, CollisionEnterEvent, CollisionExitEvent, CreateBodyCommand, RemoveBodyCommand, TriggerEnterEvent, TriggerExitEvent, type ApplyImpulseRequest, type CastRayRequest, type CreateBodyRequest, type RemoveBodyRequest } from "../../contracts/physics/types";
import { PhysicsService } from "../../engine/physics/internal/PhysicsService";

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
      conflicts: [],
    },
  };

export function createPhysicsPlugin():
  Plugin {
  return {
    manifest:
      physicsManifest,

    async setup(
      ctx: PluginContext,
    ): Promise<void> {
      const service =
        new PhysicsService(
          ctx,
        );

      const initialized =
        await service
          .initialize();

      if (!initialized) {
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
        ctx.events.on(
          "game.loop.tick",
          (
            envelope,
          ): void => {
            const payload =
              envelope.payload as {
                deltaTimeSeconds?:
                  number;
              };

            const deltaTimeSeconds =
              payload
                .deltaTimeSeconds ??
              1 / 60;

            service.step(
              deltaTimeSeconds,
            );
          },
        );

      const unbindCreate =
        ctx.commands.handle(
          "game.physics.create-body",
          (
            envelope,
          ) => {
            const payload =
              envelope.payload as
                CreateBodyRequest;

            return service
              .createBody(
                payload.entityId,
                payload.bodyDesc,
                payload.colliderDesc,
              );
          },
        );

      const unbindRemove =
        ctx.commands.handle(
          "game.physics.remove-body",
          (
            envelope,
          ) => {
            const payload =
              envelope.payload as
                RemoveBodyRequest;

            return service
              .removeBody(
                payload.entityId,
              );
          },
        );

      const unbindImpulse =
        ctx.commands.handle(
          "game.physics.apply-impulse",
          (
            envelope,
          ) => {
            const payload =
              envelope.payload as
                ApplyImpulseRequest;

            return service
              .applyImpulse(
                payload.entityId,
                payload.impulse,
              );
          },
        );

      const unbindRay =
        ctx.commands.handle(
          "game.physics.cast-ray",
          (
            envelope,
          ) => {
            const payload =
              envelope.payload as
                CastRayRequest;

            return service
              .castRay(
                payload.ray,
              );
          },
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