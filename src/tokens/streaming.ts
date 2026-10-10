import { defineCapability } from "@core";
import type {
  LODEntityDescriptor,
  StreamingSectorDescriptor,
  SectorCoord,
  SectorLoadingState,
  Vector3Streaming,
  LODLevel,
  HLODBuildOptions,
  HLODBuildResult,
  StreamingCenterSource,
  StreamingStats,
} from "../contracts/streaming/types";

export interface HLODStats {
  /** Proxies HLOD construídos (malhas realmente fundidas). */
  readonly totalClusters: number;
  /** Malhas de origem − draw calls dos proxies. */
  readonly drawCallsSaved: number;
  /** Malhas de origem fundidas. */
  readonly mergedMeshCount: number;
}

export interface StreamingApi {
  /** Registra (ou substitui) e avalia o nível JÁ (níveis em qualquer ordem). */
  registerLODEntity(descriptor: LODEntityDescriptor): void;
  unregisterLODEntity(entityId: string): boolean;
  /**
   * Define o centro do streaming e passa a origem para "explicit" (a câmera
   * deixa de sobrescrever). Volte com `setCenterSource("camera")`.
   */
  updateStreamingCenter(position: Vector3Streaming): void;

  /** Registra (ou atualiza bounds/assets de) um setor. */
  registerSector(descriptor: StreamingSectorDescriptor): void;
  /**
   * Carga manual: carrega os `assetUrls` (via game.assets) e emite
   * `sector-loaded`. O setor fica FIXO até `releaseSector`/`unloadSector`.
   */
  loadSector(sectorCoord: SectorCoord, priority?: number): Promise<boolean>;
  /** Descarga manual: a regra de raio não recarrega até o setor sair do raio. */
  unloadSector(sectorCoord: SectorCoord): boolean;
  getActiveSectors(): ReadonlyArray<SectorCoord>;

  getHLODStats(): HLODStats;
  getEntityLODLevel(entityId: string): LODLevel | null;

  update(cameraPosition: Vector3Streaming, deltaSeconds: number): void;
  /**
   * Descarrega e remove setores (com `sector-unloaded`), LODs e HLODs.
   * Mantém câmera, origem do centro e raio.
   */
  clear(): void;

  // ── Adições (G17/G60–G63) ───────────────────────────────────────────────

  /** Remove um setor (descarrega antes, com evento). */
  unregisterSector(sectorCoord: SectorCoord): boolean;
  /** Devolve o setor à regra de raio (desfaz pin/supressão manual). */
  releaseSector(sectorCoord: SectorCoord): boolean;
  isSectorPinned(sectorCoord: SectorCoord): boolean;
  getSectorState(sectorCoord: SectorCoord): SectorLoadingState;
  /** Asset carregado do setor (instância GLTF, textura...), ou null. */
  getSectorAsset(sectorCoord: SectorCoord, url: string): unknown;
  setStreamingRadius(loadRadius: number, hysteresisMargin?: number): void;
  setCenterSource(source: StreamingCenterSource): void;
  getStreamingCenter(): Vector3Streaming;
  setMaxConcurrentLoads(count: number): void;
  /** Move uma entidade de LOD. */
  updateLODEntityPosition(entityId: string, position: Vector3Streaming): boolean;
  /** Histerese global de LOD (unidades). Padrão 2. */
  setLODHysteresis(margin: number): void;
  /** HLOD real: funde as malhas da cena (`meshKeys`) do setor num proxy por material. */
  buildHLOD(sectorCoord: SectorCoord, meshKeys: ReadonlyArray<string>, options?: HLODBuildOptions): HLODBuildResult | null;
  /** HLOD a partir do `hlodCluster` do setor (combinedMeshUrl ou staticMeshUrls via game.assets). */
  buildHLODFromCluster(sectorCoord: SectorCoord, options?: HLODBuildOptions): Promise<HLODBuildResult | null>;
  removeHLOD(sectorCoord: SectorCoord): boolean;
  isHLODActive(sectorCoord: SectorCoord): boolean;
  getStats(): StreamingStats;
}

export const StreamingToken = defineCapability<StreamingApi>("game.streaming", "1.0.0");
