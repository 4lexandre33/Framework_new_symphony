import { defineCapability } from "../core/contracts/capability-token";
import type {
  LODEntityDescriptor,
  StreamingSectorDescriptor,
  SectorCoord,
  Vector3Streaming,
  LODLevel,
} from "../contracts/streaming/types";

export interface HLODStats {
  readonly totalClusters: number;
  readonly drawCallsSaved: number;
  readonly mergedMeshCount: number;
}

export interface StreamingApi {
  registerLODEntity(descriptor: LODEntityDescriptor): void;
  unregisterLODEntity(entityId: string): boolean;
  updateStreamingCenter(position: Vector3Streaming): void;

  registerSector(descriptor: StreamingSectorDescriptor): void;
  loadSector(sectorCoord: SectorCoord): Promise<boolean>;
  unloadSector(sectorCoord: SectorCoord): boolean;
  getActiveSectors(): ReadonlyArray<SectorCoord>;
  
  getHLODStats(): HLODStats;
  getEntityLODLevel(entityId: string): LODLevel | null;

  update(cameraPosition: Vector3Streaming, deltaSeconds: number): void;
  clear(): void;
}

export const StreamingToken = defineCapability<StreamingApi>("game.streaming", "1.0.0");