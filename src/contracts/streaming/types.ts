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
  /**
   * URL de asset OU chave do jogo (G132). Só é carregada via `game.assets`
   * quando `preload` é true, ou (sem `preload`) quando PARECE URL: tem
   * esquema (`http(s):`, `blob:`, `data:`, `file:`, `asset:`, `tauri:`), começa com `/`, `./`, `../` ou termina em
   * extensão (`.glb`, `.gltf`…). Ex.: `"tree-low"` não carrega.
   */
  readonly meshUrl: string;
  /** G132: true força o pré-carregamento de `meshUrl`; false nunca carrega. */
  readonly preload?: boolean;
  readonly maxScreenSpaceError?: number;
}

export interface LODEntityDescriptor {
  readonly entityId: string;
  readonly worldPosition: Vector3Streaming;
  /** Qualquer ordem: a engine ordena por `distanceThreshold` (G63). */
  readonly lodLevels: ReadonlyArray<LODLevelDescriptor>;
  /** Nível inicial declarado; o real é avaliado JÁ no registro (G63). */
  readonly currentLevel: LODLevel;
  /** Histerese (unidades de mundo) desta entidade. Padrão = `setLODHysteresis` (2). */
  readonly hysteresis?: number;
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
  /**
   * Carregados via `game.assets` (se presente) antes de `sector-loaded` e
   * liberados no unload (G17). Tipo pela extensão: .gltf/.glb, imagens,
   * áudio, .json; demais como binário.
   */
  readonly assetUrls: ReadonlyArray<string>;
  readonly hlodCluster?: HLODClusterDescriptor;
  /** Prioridade de carga (maior primeiro). Padrão 0. */
  readonly priority?: number;
}

/** Origem do centro do streaming (G17). */
export type StreamingCenterSource = "camera" | "explicit";

export interface HLODBuildOptions {
  /** Distância (do centro ao centro do setor) a partir da qual o proxy aparece. Padrão = raio de carga. */
  readonly switchDistance?: number;
  /** Além disto o proxy também some. Padrão infinito. */
  readonly maxDistance?: number;
  /** Esconde os originais (chaves de cena) enquanto o proxy está ativo. Padrão true. */
  readonly hideSources?: boolean;
}

export interface HLODBuildResult {
  /** Chave de cena do proxy (`hlod_<x>:<y>:<z>`). */
  readonly sceneKey: string;
  readonly sourceMeshCount: number;
  /** Draw calls do proxy (1 por material). */
  readonly mergedDrawCalls: number;
  readonly vertexCount: number;
  /** Malhas ignoradas (skinned, instanced, multi-material). */
  readonly skippedMeshCount: number;
}

export interface StreamingStats {
  readonly registeredSectors: number;
  readonly loadedSectors: number;
  readonly loadingSectors: number;
  readonly queuedSectors: number;
  readonly pinnedSectors: number;
  readonly lodEntities: number;
  readonly hlodClusters: number;
  readonly activeHLODs: number;
  readonly assetsLoaded: number;
  readonly assetsFailed: number;
  readonly lastLoadTimeMs: number;
  readonly averageLoadTimeMs: number;
  readonly centerSource: StreamingCenterSource;
}

// ── EVENTOS DE STREAMING & LOD ─────────────────────────────────────────────

export interface SectorLoadedPayload {
  readonly sectorCoord: SectorCoord;
  readonly loadedAssetsCount: number;
  readonly loadTimeMs: number;
  /** Assets que falharam (o setor carrega mesmo assim). */
  readonly failedAssetsCount?: number;
  /** true se foi pedido à mão (`loadSector`): fica fixo até `releaseSector`/`unloadSector`. */
  readonly pinned?: boolean;
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
  /** `meshUrl` do novo nível (pré-carregado via `game.assets` só se for URL ou `preload: true`, G132). */
  readonly meshUrl?: string;
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