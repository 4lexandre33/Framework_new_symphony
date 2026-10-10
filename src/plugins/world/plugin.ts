import type { Plugin, PluginContext } from "@core";
import { WorldToken } from "../../tokens/world";
import { AssetsToken } from "../../tokens/assets";
import { GameLoopToken } from "../../tokens/game-loop";
import { SceneLoadingEvent, SceneLoadedEvent, SceneUnloadedEvent, WorldStateRestoredEvent, EntitySpawnedEvent, EntityDespawnedEvent, LoadSceneCommand, UnloadSceneCommand, SpawnEntityCommand, DespawnEntityCommand, UpdateEntityTransformCommand, type SceneDescriptor, type SceneLoadOptions, type EntitySpawnInput, type UpdateEntityTransformRequest } from "../../contracts/world/types";
import { WorldService } from "../../engine/world/internal/WorldService";

export const worldManifest:
  Plugin["manifest"] = {
    id:
      "game.world",

    name:
      "Scene Manager, World State & ECS Plugin",

    version:
      "1.0.0",

    kind:
      "preloaded",

    authority:
      "game",

    permissions: {
      capabilities: [
        WorldToken.id,
        AssetsToken.id,
        GameLoopToken.id,
      ],

      events: [
        "game.world.scene-loading",
        "game.world.scene-loaded",
        "game.world.scene-unloaded",
        "game.world.state-restored",
        "game.world.entity-spawned",
        "game.world.entity-despawned",
        "game.loop.tick",
        "game.loop.render",
      ],
    },

    capabilities: {
      provides: [
        {
          id:
            WorldToken.id,

          version:
            "1.0.0",
        },
      ],
      // Opcionais: pré-carregamento de assets da cena e autoStartLoop.
      consumes: [
        {
          id:
            AssetsToken.id,
          range:
            "^1.0.0",
          optional: true,
        },
        {
          id:
            GameLoopToken.id,
          range:
            "^1.0.0",
          optional: true,
        },
      ],
      conflicts: [],
    },
  };

export function createWorldPlugin():
  Plugin {
  return {
    manifest:
      worldManifest,

    setup(
      ctx: PluginContext,
    ): void {
      const worldService =
        new WorldService(
          ctx,
        );

      ctx.caps.provide(
        WorldToken,
        worldService,
      );

      ctx.events.define(
        SceneLoadingEvent,
      );

      ctx.events.define(
        SceneLoadedEvent,
      );

      ctx.events.define(
        EntitySpawnedEvent,
      );

      ctx.events.define(
        EntityDespawnedEvent,
      );

      ctx.events.define(
        SceneUnloadedEvent,
      );

      ctx.events.define(
        WorldStateRestoredEvent,
      );

      ctx.commands.define(
        LoadSceneCommand,
      );

      ctx.commands.define(
        UnloadSceneCommand,
      );

      ctx.commands.define(
        SpawnEntityCommand,
      );

      ctx.commands.define(
        DespawnEntityCommand,
      );

      ctx.commands.define(
        UpdateEntityTransformCommand,
      );

      const unbindTick =
        ctx.events.on(
          "game.loop.tick",
          (): void => {
            worldService.tick();
          },
        );

      const unbindLoad =
        ctx.commands.handle(
          "game.world.load-scene",
          async (
            env,
          ) => {
            const payload =
              env.payload as {
                scene:
                  SceneDescriptor;

                options?:
                  SceneLoadOptions;
              };

            return await worldService
              .loadScene(
                payload.scene,
                payload.options,
              );
          },
        );

      const unbindUnload =
        ctx.commands.handle(
          "game.world.unload-scene",
          async (
            env,
          ) => {
            const payload =
              env.payload as {
                sceneId:
                  string;
              };

            return await worldService
              .unloadScene(
                payload.sceneId,
              );
          },
        );

      const unbindSpawn =
        ctx.commands.handle(
          "game.world.spawn-entity",
          (
            env,
          ) => {
            const payload =
              env.payload as {
                state:
                  EntitySpawnInput;
              };

            return worldService
              .spawnEntity(
                payload.state,
              );
          },
        );

      const unbindDespawn =
        ctx.commands.handle(
          "game.world.despawn-entity",
          (
            env,
          ) => {
            const payload =
              env.payload as {
                entityId:
                  string;
              };

            return worldService
              .despawnEntity(
                payload.entityId,
              );
          },
        );

      const unbindUpdateTransform =
        ctx.commands.handle(
          "game.world.update-entity-transform",
          (
            env,
          ) => {
            const payload =
              env.payload as UpdateEntityTransformRequest;

            return worldService
              .updateEntityTransform(
                payload.entityId,
                payload.patch,
              );
          },
        );

      ctx.lifecycle.onDispose(
        (): void => {
          unbindTick();
          unbindUpdateTransform();
          unbindLoad();
          unbindUnload();
          unbindSpawn();
          unbindDespawn();

          worldService.clear();
        },
      );

      ctx.lifecycle.ready();
    },
  };
}