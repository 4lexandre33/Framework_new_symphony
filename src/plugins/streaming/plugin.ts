import type { Plugin, PluginContext } from "@core";
import { StreamingToken } from "../../tokens/streaming";
import { CameraToken } from "../../tokens/camera";
import type { GameTickPayload } from "../../contracts/game-loop/types";
import { ForceSectorUnloadCommand, LODLevelChangedEvent, RequestSectorLoadCommand, SectorLoadedEvent, SectorUnloadedEvent, SetStreamingRadiusCommand, type ForceSectorUnloadPayload, type RequestSectorLoadPayload, type SetStreamingRadiusPayload } from "../../contracts/streaming/types";
import { StreamingService } from "../../engine/streaming/internal/StreamingService";

export const streamingManifest: Plugin["manifest"] = {
  id: "game.streaming",
  name: "Proximity Streaming, HLOD & Worker Pool Plugin",
  version: "1.0.0",
  kind: "preloaded",
  authority: "game",
  dependsOn: [
    {
      id: "game.loop",
      range: "^1.0.0",
    },
    {
      id: "game.camera",
      range: "^1.0.0",
    },
  ],
  permissions: {
    capabilities: [
      StreamingToken.id,
      CameraToken.id,
    ],
    events: [
      SectorLoadedEvent.type,
      SectorUnloadedEvent.type,
      LODLevelChangedEvent.type,
      "game.loop.tick",
    ],
  },
  capabilities: {
    provides: [
      {
        id: StreamingToken.id,
        version: "1.0.0",
      },
    ],
    consumes: [
      {
        id: CameraToken.id,
        range: "^1.0.0",
        optional: false,
      },
    ],
    conflicts: [],
  },
};

export function createStreamingPlugin(): Plugin {
  let streamingService: StreamingService | null = null;

  const manifest: Plugin["manifest"] = {
    ...streamingManifest,
    lifecycleHooks: {
      ...streamingManifest.lifecycleHooks,
      onBoot(ctx: PluginContext): void {
        if (!streamingService) {
          throw new Error("StreamingService não foi criado durante setup().");
        }

        streamingService.bindCamera(
          ctx.caps.require(CameraToken),
        );
      },
    },
  };

  return {
    manifest,

    setup(ctx: PluginContext): void {
      const service = new StreamingService(ctx);
      streamingService = service;

      ctx.caps.provide(StreamingToken, service);

      ctx.events.define(SectorLoadedEvent);
      ctx.events.define(SectorUnloadedEvent);
      ctx.events.define(LODLevelChangedEvent);

      ctx.commands.define(RequestSectorLoadCommand);
      ctx.commands.define(ForceSectorUnloadCommand);
      ctx.commands.define(SetStreamingRadiusCommand);

      const unbindTick = ctx.events.on(
        "game.loop.tick",
        (envelope): void => {
          const payload = envelope.payload as GameTickPayload;
          service.updateFromBoundCamera(payload.deltaSeconds);
        },
      );

      const unbindLoadSector = ctx.commands.handle(
        RequestSectorLoadCommand.type,
        (envelope): Promise<boolean> => {
          const payload = envelope.payload as RequestSectorLoadPayload;
          return service.loadSector(payload.sectorCoord);
        },
      );

      const unbindUnloadSector = ctx.commands.handle(
        ForceSectorUnloadCommand.type,
        (envelope): boolean => {
          const payload = envelope.payload as ForceSectorUnloadPayload;
          return service.unloadSector(payload.sectorCoord);
        },
      );

      const unbindSetRadius = ctx.commands.handle(
        SetStreamingRadiusCommand.type,
        (envelope): void => {
          const payload = envelope.payload as SetStreamingRadiusPayload;
          service.setStreamingRadius(
            payload.loadRadius,
            payload.hysteresisMargin,
          );
        },
      );

      ctx.lifecycle.onDispose((): void => {
        unbindTick();
        unbindLoadSector();
        unbindUnloadSector();
        unbindSetRadius();
        service.clear();

        if (streamingService === service) {
          streamingService = null;
        }
      });

      ctx.lifecycle.ready();
    },
  };
}