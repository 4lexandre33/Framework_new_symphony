import type { PluginContext } from "@core";
import { type HLODStats, type StreamingApi } from "../../../tokens/streaming";
import { type CameraApi } from "../../../tokens/camera";
import { LODLevelChangedEvent, SectorLoadedEvent, SectorUnloadedEvent, type LODEntityDescriptor, type LODLevel, type SectorCoord, type StreamingSectorDescriptor, type Vector3Streaming } from "../../../contracts/streaming/types";
import { DistanceLODManager } from "./DistanceLODManager";
import { WorldStreamingSectorManager } from "./WorldStreamingSectorManager";
import { HLODBuilder } from "./HLODBuilder";
import { StreamingWorkerPool } from "./StreamingWorkerPool";

export interface MutableVector3Streaming {
  x: number;
  y: number;
  z: number;
}

export const SECTOR_UPDATE_INTERVAL_SECONDS = 0.1;

export const MAX_FRAME_DELTA_SECONDS = 0.25;

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
    this.camera = null;
    this.sectorUpdateAccumulatorSeconds = 0;
    this.hasPerformedInitialSectorUpdate = false;
    this.centerPosition.x = 0;
    this.centerPosition.y = 0;
    this.centerPosition.z = 0;
  }

  public dispose(): void {
    this.clear();
    this.workerPool.clear();
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