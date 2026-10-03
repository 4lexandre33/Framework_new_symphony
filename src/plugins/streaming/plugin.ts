import type {
  Plugin,
  PluginContext,
} from "../../core/contracts/plugin-context";

import {
  StreamingToken,
  type HLODStats,
  type StreamingApi,
} from "../../tokens/streaming";

import {
  CameraToken,
  type CameraApi,
} from "../../tokens/camera";

import type {
  GameTickPayload,
} from "../../contracts/game-loop/types";

import {
  ForceSectorUnloadCommand,
  LODLevelChangedEvent,
  RequestSectorLoadCommand,
  SectorLoadedEvent,
  SectorUnloadedEvent,
  SetStreamingRadiusCommand,
  type ForceSectorUnloadPayload,
  type LODEntityDescriptor,
  type LODLevel,
  type RequestSectorLoadPayload,
  type SectorCoord,
  type SetStreamingRadiusPayload,
  type StreamingSectorDescriptor,
  type Vector3Streaming,
} from "../../contracts/streaming/types";

import {
  DistanceLODManager,
} from "../../engine/streaming/DistanceLODManager";

import {
  WorldStreamingSectorManager,
} from "../../engine/streaming/WorldStreamingSectorManager";

import {
  HLODBuilder,
} from "../../engine/streaming/HLODBuilder";

import {
  StreamingWorkerPool,
} from "../../engine/streaming/StreamingWorkerPool";

interface MutableVector3Streaming {
  x: number;
  y: number;
  z: number;
}

const SECTOR_UPDATE_INTERVAL_SECONDS = 0.1;
const MAX_FRAME_DELTA_SECONDS = 0.25;

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
      },
    ],
  },
};

export class StreamingService implements StreamingApi {
  private readonly lodManager = new DistanceLODManager();
  private readonly sectorManager = new WorldStreamingSectorManager();
  private readonly hlodBuilder = new HLODBuilder();
  private readonly workerPool = new StreamingWorkerPool();
  private readonly centerPosition: MutableVector3Streaming = {
    x: 0,
    y: 0,
    z: 0,
  };

  private camera: CameraApi | null = null;
  private sectorUpdateAccumulatorSeconds = 0;
  private hasPerformedInitialSectorUpdate = false;

  private readonly handleLODChanged = (
    entityId: string,
    previousLevel: LODLevel,
    newLevel: LODLevel,
  ): void => {
    this.ctx.events.emit(LODLevelChangedEvent.type, {
      entityId,
      previousLevel,
      newLevel,
    });
  };

  private readonly requestSectorLoad = (coord: SectorCoord): void => {
    void this.loadSector(coord);
  };

  private readonly requestSectorUnload = (coord: SectorCoord): void => {
    this.unloadSector(coord);
  };

  public constructor(private readonly ctx: PluginContext) {}

  public bindCamera(camera: CameraApi): void {
    this.camera = camera;
  }

  public registerLODEntity(descriptor: LODEntityDescriptor): void {
    this.lodManager.registerEntity(descriptor);
  }

  public unregisterLODEntity(entityId: string): boolean {
    return this.lodManager.unregisterEntity(entityId);
  }

  public updateStreamingCenter(position: Vector3Streaming): void {
    this.centerPosition.x = position.x;
    this.centerPosition.y = position.y;
    this.centerPosition.z = position.z;
  }

  public setStreamingRadius(loadRadius: number, hysteresisMargin: number): void {
    this.sectorManager.setStreamingRadius(loadRadius, hysteresisMargin);
    this.sectorUpdateAccumulatorSeconds = SECTOR_UPDATE_INTERVAL_SECONDS;
  }

  public registerSector(descriptor: StreamingSectorDescriptor): void {
    this.sectorManager.registerSector(descriptor);

    if (descriptor.hlodCluster) {
      this.hlodBuilder.registerCluster(descriptor.hlodCluster);
    }
  }

  public async loadSector(sectorCoord: SectorCoord): Promise<boolean> {
    const descriptor = this.sectorManager.getSectorDescriptor(sectorCoord);

    if (!descriptor) {
      return false;
    }

    const currentState = this.sectorManager.getSectorState(sectorCoord);

    if (currentState === "loaded") {
      return true;
    }

    const startedAt = this.nowMilliseconds();

    if (!this.sectorManager.setSectorState(sectorCoord, "loaded")) {
      return false;
    }

    this.ctx.events.emit(SectorLoadedEvent.type, {
      sectorCoord,
      loadedAssetsCount: 0,
      loadTimeMs: Math.max(0, this.nowMilliseconds() - startedAt),
    });

    return true;
  }

  public unloadSector(sectorCoord: SectorCoord): boolean {
    if (!this.sectorManager.hasSector(sectorCoord)) {
      return false;
    }

    const currentState = this.sectorManager.getSectorState(sectorCoord);

    if (currentState === "unloaded") {
      return true;
    }

    if (!this.sectorManager.setSectorState(sectorCoord, "unloaded")) {
      return false;
    }

    this.ctx.events.emit(SectorUnloadedEvent.type, {
      sectorCoord,
    });

    return true;
  }

  public getActiveSectors(): ReadonlyArray<SectorCoord> {
    return this.sectorManager.getActiveSectors();
  }

  public getHLODStats(): HLODStats {
    return this.hlodBuilder.getStats();
  }

  public getEntityLODLevel(entityId: string): LODLevel | null {
    return this.lodManager.getEntityLOD(entityId);
  }

  public update(cameraPosition: Vector3Streaming, deltaSeconds: number): void {
    this.updateStreamingCenter(cameraPosition);

    this.lodManager.updateLODs(
      this.centerPosition,
      this.handleLODChanged,
    );

    const safeDeltaSeconds = this.sanitizeDeltaSeconds(deltaSeconds);
    this.sectorUpdateAccumulatorSeconds += safeDeltaSeconds;

    if (
      this.hasPerformedInitialSectorUpdate &&
      this.sectorUpdateAccumulatorSeconds < SECTOR_UPDATE_INTERVAL_SECONDS
    ) {
      return;
    }

    this.hasPerformedInitialSectorUpdate = true;
    this.sectorUpdateAccumulatorSeconds = 0;

    this.sectorManager.updateStreamingSectors(
      this.centerPosition,
      this.requestSectorLoad,
      this.requestSectorUnload,
    );
  }

  public updateFromBoundCamera(deltaSeconds: number): void {
    const snapshot = this.camera?.getCurrentCameraSnapshot() ?? null;

    if (snapshot) {
      this.update(snapshot.position, deltaSeconds);
      return;
    }

    this.update(this.centerPosition, deltaSeconds);
  }

  public clear(): void {
    this.lodManager.clear();
    this.sectorManager.clear();
    this.hlodBuilder.clear();
    this.workerPool.clear();
    this.camera = null;
    this.sectorUpdateAccumulatorSeconds = 0;
    this.hasPerformedInitialSectorUpdate = false;
    this.centerPosition.x = 0;
    this.centerPosition.y = 0;
    this.centerPosition.z = 0;
  }

  private sanitizeDeltaSeconds(deltaSeconds: number): number {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
      return 0;
    }

    return Math.min(deltaSeconds, MAX_FRAME_DELTA_SECONDS);
  }

  private nowMilliseconds(): number {
    if (typeof performance !== "undefined") {
      return performance.now();
    }

    return Date.now();
  }
}

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
