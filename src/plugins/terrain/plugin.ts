import type { Plugin, PluginContext } from "@core";
import { TerrainToken } from "../../tokens/terrain";
import { RenderToken } from "../../tokens/render";
import type { GameTickPayload } from "../../contracts/game-loop/types";
import { BlockModifiedEvent, ChunkGeneratedEvent, ModifyVoxelBlockCommand, RequestChunkLoadCommand, type ModifyVoxelBlockPayload, type RequestChunkLoadPayload } from "../../contracts/terrain/types";
import { TerrainService } from "../../engine/terrain/internal/TerrainService";

export const terrainManifest:
  Plugin["manifest"] = {
    id:
      "game.terrain",

    name:
      "Procedural Terrain, Biomes & Voxel Plugin",

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
          "game.render",

        range:
          "^1.0.0",
      },
    ],

    permissions: {
      capabilities: [
        TerrainToken.id,
        RenderToken.id,
      ],

      events: [
        ChunkGeneratedEvent.type,
        BlockModifiedEvent.type,
        "game.loop.tick",
      ],
    },

    capabilities: {
      provides: [
        {
          id:
            TerrainToken.id,

          version:
            "1.0.0",
        },
      ],

      consumes: [
        {
          id:
            RenderToken.id,

          range:
            "^1.0.0",
          optional: false,
        },
      ],
      conflicts: [],
    },
  };

export function createTerrainPlugin():
  Plugin {
  let terrainService:
    TerrainService | null =
      null;

  const manifest:
    Plugin["manifest"] = {
      ...terrainManifest,

      lifecycleHooks: {
        ...terrainManifest.lifecycleHooks,

        onBoot(
          ctx:
            PluginContext,
        ): void {
          if (!terrainService) {
            throw new Error(
              "TerrainService não foi criado durante setup().",
            );
          }

          const render =
            ctx.caps.require(
              RenderToken,
            );

          terrainService
            .bindDependencies(
              render,
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
        new TerrainService(
          ctx,
        );

      terrainService =
        service;

      ctx.caps.provide(
        TerrainToken,
        service,
      );

      ctx.events.define(
        ChunkGeneratedEvent,
      );

      ctx.events.define(
        BlockModifiedEvent,
      );

      ctx.commands.define(
        RequestChunkLoadCommand,
      );

      ctx.commands.define(
        ModifyVoxelBlockCommand,
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

      const unbindRequestChunk =
        ctx.commands.handle(
          RequestChunkLoadCommand.type,
          (
            envelope,
          ): void => {
            const payload =
              envelope.payload as
                RequestChunkLoadPayload;

            if (
              payload.seed !==
              service.getSeed()
            ) {
              service.setSeed(
                payload.seed,
              );
            }

            service.requestChunk(
              payload.chunkCoord,
            );
          },
        );

      const unbindModifyBlock =
        ctx.commands.handle(
          ModifyVoxelBlockCommand.type,
          (
            envelope,
          ): boolean => {
            const payload =
              envelope.payload as
                ModifyVoxelBlockPayload;

            return service
              .modifyVoxelBlock(
                payload.request,
              );
          },
        );

      ctx.lifecycle.onDispose(
        (): void => {
          unbindTick();
          unbindRequestChunk();
          unbindModifyBlock();

          service.dispose();

          if (
            terrainService ===
            service
          ) {
            terrainService =
              null;
          }
        },
      );

      ctx.lifecycle.ready();
    },
  };
}