import { defineEvent, defineCommand } from "@core";

export interface Vector3Streaming {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface SectorCoord {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export type LODLevel = 0 | 1 | 2 | 3; // 0 = Alta fidelidade, 3 = Billboard/HLOD

export interface LODLevelDescriptor {
  readonly level: LODLevel;
  readonly distanceThreshold: number;
  readonly meshUrl: string;
  readonly maxScreenSpaceError?: number;
}

export interface LODEntityDescriptor {
  readonly entityId: string;
  readonly worldPosition: Vector3Streaming;
  readonly lodLevels: ReadonlyArray<LODLevelDescriptor>;
  readonly currentLevel: LODLevel;
}

export interface HLODClusterDescriptor {
  readonly clusterId: string;
  readonly sectorCoord: SectorCoord;
  readonly staticMeshUrls: ReadonlyArray<string>;
  readonly combinedMeshUrl: string;
  readonly boundingCenter: Vector3Streaming;
  readonly boundingRadius: number;
}

export type SectorLoadingState = "unloaded" | "loading" | "loaded" | "unloading";

export interface StreamingSectorDescriptor {
  readonly sectorCoord: SectorCoord;
  readonly boundsMin: Vector3Streaming;
  readonly boundsMax: Vector3Streaming;
  readonly assetUrls: ReadonlyArray<string>;
  readonly hlodCluster?: HLODClusterDescriptor;
}

// ── EVENTOS DE STREAMING & LOD ─────────────────────────────────────────────

export interface SectorLoadedPayload {
  readonly sectorCoord: SectorCoord;
  readonly loadedAssetsCount: number;
  readonly loadTimeMs: number;
}

export const SectorLoadedEvent = defineEvent<
  "game.streaming.sector-loaded",
  SectorLoadedPayload
>("game.streaming.sector-loaded");

export interface SectorUnloadedPayload {
  readonly sectorCoord: SectorCoord;
}

export const SectorUnloadedEvent = defineEvent<
  "game.streaming.sector-unloaded",
  SectorUnloadedPayload
>("game.streaming.sector-unloaded");

export interface LODLevelChangedPayload {
  readonly entityId: string;
  readonly previousLevel: LODLevel;
  readonly newLevel: LODLevel;
}

export const LODLevelChangedEvent = defineEvent<
  "game.streaming.lod-changed",
  LODLevelChangedPayload
>("game.streaming.lod-changed");

// ── COMANDOS DE STREAMING & LOD ─────────────────────────────────────────────

export interface RequestSectorLoadPayload {
  readonly sectorCoord: SectorCoord;
  readonly priority?: number;
}

export const RequestSectorLoadCommand = defineCommand<
  "game.streaming.request-sector-load",
  RequestSectorLoadPayload
>("game.streaming.request-sector-load");

export interface ForceSectorUnloadPayload {
  readonly sectorCoord: SectorCoord;
}

export const ForceSectorUnloadCommand = defineCommand<
  "game.streaming.force-sector-unload",
  ForceSectorUnloadPayload
>("game.streaming.force-sector-unload");

export interface SetStreamingRadiusPayload {
  readonly loadRadius: number;
  readonly hysteresisMargin: number;
}

export const SetStreamingRadiusCommand = defineCommand<
  "game.streaming.set-radius",
  SetStreamingRadiusPayload
>("game.streaming.set-radius");