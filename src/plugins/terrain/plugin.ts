import type { Plugin, PluginContext } from "@core";
import { TerrainToken } from "../../tokens/terrain";
import { RenderToken } from "../../tokens/render";
import { PhysicsToken, type PhysicsApi } from "../../tokens/physics";
import { CameraToken, type CameraApi } from "../../tokens/camera";
import type { GameRenderPayload, GameTickPayload } from "../../contracts/game-loop/types";
import { BlockModifiedEvent, ChunkGeneratedEvent, ChunkUnloadedEvent, ModifyVoxelBlockCommand, RequestChunkLoadCommand, TerrainResetEvent, type ModifyVoxelBlockPayload, type RequestChunkLoadPayload } from "../../contracts/terrain/types";
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

      // Opcionais: colliders por chunk (G3) e centro do streaming pela câmera.
      {
        id:
          "game.physics",

        range:
          "^1.0.0",

        optional:
          true,
      },

      {
        id:
          "game.camera",

        range:
          "^1.0.0",

        optional:
          true,
      },
    ],

    permissions: {
      capabilities: [
        TerrainToken.id,
        RenderToken.id,
        PhysicsToken.id,
        CameraToken.id,
      ],

      events: [
        ChunkGeneratedEvent.type,
        BlockModifiedEvent.type,
        ChunkUnloadedEvent.type,
        TerrainResetEvent.type,
        "game.loop.tick",
        "game.loop.render",
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

        {
          id:
            PhysicsToken.id,

          range:
            "^1.0.0",
          optional: true,
        },

        {
          id:
            CameraToken.id,

          range:
            "^1.0.0",
          optional: true,
        },
      ],
      conflicts: [],
    },
  };

function getOptional<T>(read: () => T | undefined): T | null {
  try {
    return read() ?? null;
  } catch {
    return null;
  }
}

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

          const physics =
            getOptional<PhysicsApi>(
              () => ctx.caps.get(PhysicsToken),
            );

          const camera =
            getOptional<CameraApi>(
              () => ctx.caps.get(CameraToken),
            );

          terrainService
            .bindDependencies(
              render,
              physics,
              camera,
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

      ctx.events.define(
        ChunkUnloadedEvent,
      );

      ctx.events.define(
        TerrainResetEvent,
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

      // Pausado não há tick: as malhas pendentes continuam sendo montadas por frame.
      const unbindRender =
        ctx.events.on(
          "game.loop.render",
          (
            envelope,
          ): void => {
            const payload =
              envelope.payload as
                GameRenderPayload;

            if (payload.isPaused) {
              service.processMeshQueue();
            }
          },
        );

      const unbindRequestChunk =
        ctx.commands.handle(
          RequestChunkLoadCommand.type,
          (
            envelope,
          ): boolean => {
            const payload =
              envelope.payload as
                RequestChunkLoadPayload;

            const seed =
              payload.seed;

            if (
              typeof seed === "number" &&
              Number.isFinite(seed) &&
              Math.trunc(seed) !==
                service.getSeed()
            ) {
              // G55: seed divergente nunca apaga o mundo em silêncio.
              if (service.hasWorldContent()) {
                ctx.log.warn(
                  "game.terrain.request-chunk recusado: seed difere da do mundo atual (use setSeed para trocar de mundo).",
                  {
                    requestedSeed: seed,
                    currentSeed: service.getSeed(),
                  },
                );

                return false;
              }

              service.setSeed(
                seed,
              );
            }

            service.requestChunk(
              payload.chunkCoord,
            );

            return true;
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

            if (
              Array.isArray(
                payload.requests,
              )
            ) {
              return service
                .modifyVoxelBlocks(
                  payload.requests,
                ) > 0;
            }

            if (!payload.request) {
              return false;
            }

            return service
              .modifyVoxelBlock(
                payload.request,
              );
          },
        );

      ctx.lifecycle.onDispose(
        (): void => {
          unbindTick();
          unbindRender();
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
