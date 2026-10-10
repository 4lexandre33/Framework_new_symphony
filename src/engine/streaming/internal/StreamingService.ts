import type { PluginContext } from "@core";
import type * as THREE from "three";
import { type HLODStats, type StreamingApi } from "../../../tokens/streaming";
import { type CameraApi } from "../../../tokens/camera";
import type { AssetsApi } from "../../../tokens/assets";
import type { Render3DApi } from "../../../tokens/render";
import {
  LODLevelChangedEvent,
  SectorLoadedEvent,
  SectorUnloadedEvent,
  type HLODBuildOptions,
  type HLODBuildResult,
  type LODEntityDescriptor,
  type LODLevel,
  type SectorCoord,
  type SectorLoadingState,
  type StreamingCenterSource,
  type StreamingSectorDescriptor,
  type StreamingStats,
  type Vector3Streaming,
} from "../../../contracts/streaming/types";
import { DistanceLODManager } from "./DistanceLODManager";
import { WorldStreamingSectorManager, type SectorRecord } from "./WorldStreamingSectorManager";
import { HLODBuilder } from "./HLODBuilder";
import { StreamingWorkerPool } from "./StreamingWorkerPool";

export interface MutableVector3Streaming {
  x: number;
  y: number;
  z: number;
}

export const SECTOR_UPDATE_INTERVAL_SECONDS = 0.1;

export const MAX_FRAME_DELTA_SECONDS = 0.25;

const DEFAULT_MAX_CONCURRENT_LOADS = 4;

interface HLODEntry {
  readonly key: string;
  readonly sectorCoord: SectorCoord;
  readonly sceneKey: string;
  readonly object: THREE.Object3D;
  readonly sourceKeys: ReadonlyArray<string>;
  readonly hideSources: boolean;
  readonly switchDistance: number | undefined;
  readonly maxDistance: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly centerZ: number;
  readonly sourceMeshCount: number;
  readonly mergedDrawCalls: number;
  /** Objetos originais escondidos por nós (para reexibir). */
  hiddenSources: THREE.Object3D[];
  active: boolean;
}

function copyCoord(coord: SectorCoord): SectorCoord {
  return { x: coord.x, y: coord.y, z: coord.z };
}

type AssetKind = "gltf" | "texture" | "audio" | "json" | "binary";

function assetKindOf(url: string): AssetKind {
  const clean = url.split(/[?#]/u)[0]?.toLowerCase() ?? "";

  if (clean.endsWith(".gltf") || clean.endsWith(".glb")) return "gltf";
  if (/\.(png|jpe?g|webp|gif|bmp|avif|ktx2)$/u.test(clean)) return "texture";
  if (/\.(mp3|ogg|wav|m4a|aac|flac|opus)$/u.test(clean)) return "audio";
  if (clean.endsWith(".json")) return "json";
  return "binary";
}

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

  private readonly loadQueue: SectorRecord[] = [];
  private readonly hlods = new Map<string, HLODEntry>();
  /** URL de malha de LOD retida por entidade (pré-carga via assets). */
  private readonly lodAssets = new Map<string, { readonly url: string; settled: boolean }>();

  private camera: CameraApi | null = null;
  private render: Render3DApi | null = null;
  private assets: AssetsApi | null = null;
  private centerSource: StreamingCenterSource = "camera";
  private hasCenter = false;
  private sectorUpdateAccumulatorSeconds = 0;
  private hasPerformedInitialSectorUpdate = false;
  private maxConcurrentLoads = DEFAULT_MAX_CONCURRENT_LOADS;
  private activeLoads = 0;
  private assetsLoaded = 0;
  private assetsFailed = 0;
  private lastLoadTimeMs = 0;
  private totalLoadTimeMs = 0;
  private completedLoads = 0;
  private disposed = false;

  private readonly handleLODChanged = (
    entityId: string,
    previousLevel: LODLevel,
    newLevel: LODLevel,
    meshUrl: string,
  ): void => {
    this.retainLODAsset(entityId, meshUrl);
    this.ctx.events.emit(LODLevelChangedEvent.type, {
      entityId,
      previousLevel,
      newLevel,
      ...(meshUrl ? { meshUrl } : {}),
    });
  };

  private readonly requestSectorLoad = (coord: SectorCoord): void => {
    const record = this.sectorManager.getRecord(coord);

    if (record) {
      this.enqueueLoad(record, false, this.autoPriority(record));
    }
  };

  private readonly requestSectorUnload = (coord: SectorCoord): void => {
    const record = this.sectorManager.getRecord(coord);

    if (record) {
      this.unloadRecord(record);
    }
  };

  public constructor(private readonly ctx: PluginContext) {}

  public bindCamera(camera: CameraApi | null): void {
    this.camera = camera;
  }

  /** Dependências opcionais: `render` (HLOD) e `assets` (assetUrls/meshUrl). */
  public bindDependencies(deps: { readonly camera?: CameraApi | null; readonly render?: Render3DApi | null; readonly assets?: AssetsApi | null }): void {
    if (deps.camera !== undefined) this.camera = deps.camera;
    if (deps.render !== undefined) this.render = deps.render;
    if (deps.assets !== undefined) this.assets = deps.assets;
  }

  // ── LOD ──────────────────────────────────────────────────────────────────

  public registerLODEntity(descriptor: LODEntityDescriptor): void {
    // Nível real avaliado JÁ (G63) quando há centro conhecido.
    this.lodManager.registerEntity(descriptor, this.hasCenter ? this.centerPosition : null, this.handleLODChanged);

    if (!this.hasCenter) {
      return;
    }

    const url = this.lodManager.getEntityMeshUrl(descriptor.entityId);

    if (url) {
      this.retainLODAsset(descriptor.entityId, url);
    }
  }

  public unregisterLODEntity(entityId: string): boolean {
    this.releaseLODAsset(entityId);
    return this.lodManager.unregisterEntity(entityId);
  }

  public updateLODEntityPosition(entityId: string, position: Vector3Streaming): boolean {
    return this.lodManager.updateEntityPosition(entityId, position);
  }

  public setLODHysteresis(margin: number): void {
    this.lodManager.setHysteresis(margin);
  }

  public getEntityLODLevel(entityId: string): LODLevel | null {
    return this.lodManager.getEntityLOD(entityId);
  }

  // ── Centro / raio ────────────────────────────────────────────────────────

  /** Define o centro e passa a origem para "explicit" (a câmera não sobrescreve mais: G17). */
  public updateStreamingCenter(position: Vector3Streaming): void {
    this.centerSource = "explicit";
    this.writeCenter(position);
  }

  public setCenterSource(source: StreamingCenterSource): void {
    if (source === "camera" || source === "explicit") {
      this.centerSource = source;
    }
  }

  public getCenterSource(): StreamingCenterSource {
    return this.centerSource;
  }

  public getStreamingCenter(): Vector3Streaming {
    return { x: this.centerPosition.x, y: this.centerPosition.y, z: this.centerPosition.z };
  }

  public setStreamingRadius(loadRadius: number, hysteresisMargin?: number): void {
    this.sectorManager.setStreamingRadius(loadRadius, hysteresisMargin);
    this.sectorUpdateAccumulatorSeconds = SECTOR_UPDATE_INTERVAL_SECONDS;
  }

  public setMaxConcurrentLoads(count: number): void {
    if (Number.isFinite(count) && count >= 1) {
      this.maxConcurrentLoads = Math.floor(count);
      this.pumpLoadQueue();
    }
  }

  // ── Setores ──────────────────────────────────────────────────────────────

  public registerSector(descriptor: StreamingSectorDescriptor): void {
    this.sectorManager.registerSector(descriptor);

    if (descriptor.hlodCluster) {
      this.hlodBuilder.registerCluster(descriptor.hlodCluster);
    }

    // Avalia o raio no próximo update.
    this.sectorUpdateAccumulatorSeconds = SECTOR_UPDATE_INTERVAL_SECONDS;
  }

  /** Remove o setor (emite `sector-unloaded` se estava carregado) e o HLOD dele (G62). */
  public unregisterSector(sectorCoord: SectorCoord): boolean {
    const record = this.sectorManager.getRecord(sectorCoord);

    if (!record) {
      return false;
    }

    this.unloadRecord(record);
    this.removeHLOD(sectorCoord);
    this.hlodBuilder.removeCluster(sectorCoord);
    this.sectorManager.removeRecord(sectorCoord);
    return true;
  }

  /**
   * Carga manual: o setor fica FIXO (a regra de raio não o descarrega) até
   * `releaseSector` ou `unloadSector` (G60). Resolve true quando carregado.
   */
  public loadSector(sectorCoord: SectorCoord, priority = 0): Promise<boolean> {
    const record = this.sectorManager.getRecord(sectorCoord);

    if (!record || this.disposed) {
      return Promise.resolve(false);
    }

    record.pinned = true;
    record.suppressed = false;

    if (record.state === "loaded") {
      return Promise.resolve(true);
    }

    return new Promise<boolean>((resolve): void => {
      record.waiters.push(resolve);
      this.enqueueLoad(record, true, Number.isFinite(priority) ? priority : 0);
    });
  }

  /**
   * Descarga manual: respeitada pela regra de raio — o setor só volta a
   * carregar sozinho depois de sair do raio (ou com `loadSector`) (G60).
   */
  public unloadSector(sectorCoord: SectorCoord): boolean {
    const record = this.sectorManager.getRecord(sectorCoord);

    if (!record) {
      return false;
    }

    record.pinned = false;
    record.suppressed = true;
    this.unloadRecord(record);
    return true;
  }

  /** Devolve o setor à regra de raio (desfaz pin/supressão). */
  public releaseSector(sectorCoord: SectorCoord): boolean {
    const record = this.sectorManager.getRecord(sectorCoord);

    if (!record) {
      return false;
    }

    record.pinned = false;
    record.suppressed = false;
    this.sectorUpdateAccumulatorSeconds = SECTOR_UPDATE_INTERVAL_SECONDS;
    return true;
  }

  public isSectorPinned(sectorCoord: SectorCoord): boolean {
    return this.sectorManager.getRecord(sectorCoord)?.pinned ?? false;
  }

  public getSectorState(sectorCoord: SectorCoord): SectorLoadingState {
    return this.sectorManager.getSectorState(sectorCoord);
  }

  /** Asset carregado para o setor (instância GLTF, textura, buffer...), ou null. */
  public getSectorAsset(sectorCoord: SectorCoord, url: string): unknown {
    const record = this.sectorManager.getRecord(sectorCoord);

    if (!record || record.state !== "loaded") {
      return null;
    }

    for (const asset of record.assets) {
      if (asset.url === url) {
        return asset.value;
      }
    }

    return null;
  }

  public getActiveSectors(): ReadonlyArray<SectorCoord> {
    return this.sectorManager.getActiveSectors();
  }

  // ── HLOD (G61) ───────────────────────────────────────────────────────────

  /**
   * Funde as malhas estáticas registradas no render sob `meshKeys` em um
   * proxy (1 draw call por material) mostrado quando o setor está longe.
   * Requer `game.render`. Substitui um HLOD anterior do mesmo setor.
   */
  public buildHLOD(
    sectorCoord: SectorCoord,
    meshKeys: ReadonlyArray<string>,
    options: HLODBuildOptions = {},
  ): HLODBuildResult | null {
    const render = this.render;

    if (render === null || this.disposed) {
      return null;
    }

    const sources: THREE.Object3D[] = [];

    for (const key of meshKeys) {
      const object = render.getMeshFromScene(key);

      if (object) {
        sources.push(object);
      }
    }

    return this.installHLOD(sectorCoord, sources, [...meshKeys], options);
  }

  /**
   * HLOD a partir do `hlodCluster` do setor: usa `combinedMeshUrl` (pronto)
   * ou funde os `staticMeshUrls` (via `game.assets`).
   */
  public async buildHLODFromCluster(sectorCoord: SectorCoord, options: HLODBuildOptions = {}): Promise<HLODBuildResult | null> {
    const cluster = this.hlodBuilder.getCluster(sectorCoord);
    const assets = this.assets;

    if (!cluster || !assets || this.render === null) {
      return null;
    }

    const urls = cluster.combinedMeshUrl ? [cluster.combinedMeshUrl] : [...cluster.staticMeshUrls];
    const sources: THREE.Object3D[] = [];
    const loaded: string[] = [];

    for (const url of urls) {
      try {
        const gltf = (await assets.loadGLTF(url)) as { scene?: THREE.Object3D } | null;
        loaded.push(url);

        if (gltf?.scene) {
          sources.push(gltf.scene);
        }
      } catch {
        this.assetsFailed += 1;
      }
    }

    try {
      if (this.disposed) {
        return null;
      }

      return this.installHLOD(sectorCoord, sources, [], {
        ...options,
        hideSources: false,
      });
    } finally {
      // A geometria fundida é cópia: as instâncias carregadas podem ser liberadas.
      for (const url of loaded) {
        assets.releaseAsset(url);
      }
    }
  }

  public removeHLOD(sectorCoord: SectorCoord): boolean {
    const key = this.sectorManager.getSectorKey(sectorCoord);
    const entry = this.hlods.get(key);

    if (!entry) {
      return false;
    }

    this.setHLODActive(entry, false);
    this.hlods.delete(key);
    this.render?.removeMeshFromScene(entry.sceneKey);
    return true;
  }

  public isHLODActive(sectorCoord: SectorCoord): boolean {
    return this.hlods.get(this.sectorManager.getSectorKey(sectorCoord))?.active ?? false;
  }

  public getHLODStats(): HLODStats {
    let saved = 0;
    let merged = 0;

    for (const entry of this.hlods.values()) {
      saved += Math.max(0, entry.sourceMeshCount - entry.mergedDrawCalls);
      merged += entry.sourceMeshCount;
    }

    return {
      totalClusters: this.hlods.size,
      drawCallsSaved: saved,
      mergedMeshCount: merged,
    };
  }

  public getStats(): StreamingStats {
    let loaded = 0;
    let loading = 0;
    let pinned = 0;

    for (const record of this.sectorManager.values()) {
      if (record.state === "loaded") loaded += 1;
      if (record.state === "loading") loading += 1;
      if (record.pinned) pinned += 1;
    }

    let activeHLODs = 0;

    for (const entry of this.hlods.values()) {
      if (entry.active) activeHLODs += 1;
    }

    return {
      registeredSectors: this.sectorManager.size,
      loadedSectors: loaded,
      loadingSectors: loading,
      queuedSectors: this.loadQueue.length,
      pinnedSectors: pinned,
      lodEntities: this.lodManager.size,
      hlodClusters: this.hlods.size,
      activeHLODs,
      assetsLoaded: this.assetsLoaded,
      assetsFailed: this.assetsFailed,
      lastLoadTimeMs: this.lastLoadTimeMs,
      averageLoadTimeMs: this.completedLoads > 0 ? this.totalLoadTimeMs / this.completedLoads : 0,
      centerSource: this.centerSource,
    };
  }

  // ── Tick ─────────────────────────────────────────────────────────────────

  public update(cameraPosition: Vector3Streaming, deltaSeconds: number): void {
    this.writeCenter(cameraPosition);

    this.lodManager.updateLODs(
      this.centerPosition,
      this.handleLODChanged,
    );

    this.updateHLODs();

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

  /** Tick da engine: centro pela câmera (se a origem for "camera") ou o explícito. */
  public updateFromBoundCamera(deltaSeconds: number): void {
    const snapshot = this.centerSource === "camera" ? this.camera?.getCurrentCameraSnapshot() ?? null : null;

    if (snapshot) {
      this.update(snapshot.position, deltaSeconds);
      return;
    }

    this.update(this.centerPosition, deltaSeconds);
  }

  /**
   * Descarrega e remove todos os setores (emite `sector-unloaded` para os
   * carregados), entidades de LOD e HLODs. Mantém câmera, origem do centro,
   * raio e histerese (G62). Reutilizável.
   */
  public clear(): void {
    for (const record of [...this.sectorManager.values()]) {
      this.unloadRecord(record);
    }

    for (const record of this.sectorManager.values()) {
      this.settleWaiters(record, false);
    }

    for (const key of [...this.hlods.keys()]) {
      const entry = this.hlods.get(key) as HLODEntry;
      this.removeHLOD(entry.sectorCoord);
    }

    for (const entityId of [...this.lodAssets.keys()]) {
      this.releaseLODAsset(entityId);
    }

    this.loadQueue.length = 0;
    this.lodManager.clear();
    this.sectorManager.clear();
    this.hlodBuilder.clear();
    this.sectorUpdateAccumulatorSeconds = 0;
    this.hasPerformedInitialSectorUpdate = false;
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.clear();
    this.disposed = true;
    this.workerPool.clear();
    this.camera = null;
    this.render = null;
    this.assets = null;
  }

  // ── Internos ─────────────────────────────────────────────────────────────

  private writeCenter(position: Vector3Streaming): void {
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)) {
      return;
    }

    this.centerPosition.x = position.x;
    this.centerPosition.y = position.y;
    this.centerPosition.z = position.z;
    this.hasCenter = true;
  }

  private autoPriority(record: SectorRecord): number {
    const dx = this.centerPosition.x - record.centerX;
    const dy = this.centerPosition.y - record.centerY;
    const dz = this.centerPosition.z - record.centerZ;
    return (record.descriptor.priority ?? 0) - Math.sqrt(dx * dx + dy * dy + dz * dz) * 0.001;
  }

  private enqueueLoad(record: SectorRecord, manual: boolean, priority: number): void {
    if (this.disposed) {
      return;
    }

    if (record.state === "loaded") {
      this.settleWaiters(record, true);
      return;
    }

    record.state = "loading";
    record.queuePriority = manual ? priority + 1_000_000 : priority;

    if (record.startedAt > 0 && !record.queued) {
      // Já carregando: só ajusta prioridade.
      this.pumpLoadQueue();
      return;
    }

    if (!record.queued) {
      record.queued = true;
      this.loadQueue.push(record);
    }

    this.loadQueue.sort((a, b) => b.queuePriority - a.queuePriority);
    this.pumpLoadQueue();
  }

  private pumpLoadQueue(): void {
    while (this.activeLoads < this.maxConcurrentLoads && this.loadQueue.length > 0) {
      const record = this.loadQueue.shift() as SectorRecord;
      record.queued = false;

      if (record.state !== "loading") {
        continue;
      }

      this.startLoad(record);
    }
  }

  private startLoad(record: SectorRecord): void {
    record.token += 1;
    const token = record.token;
    record.startedAt = this.nowMilliseconds();
    const urls = record.descriptor.assetUrls;
    const assets = this.assets;

    if (!assets || urls.length === 0) {
      this.completeLoad(record, token, [], 0);
      return;
    }

    this.activeLoads += 1;
    const loaded: Array<{ url: string; value: unknown }> = [];
    let failed = 0;

    void Promise.all(
      urls.map(async (url): Promise<void> => {
        try {
          loaded.push({ url, value: await this.loadAsset(assets, url) });
        } catch {
          failed += 1;
        }
      }),
    ).then((): void => {
      this.activeLoads -= 1;

      if (record.token !== token || this.disposed || record.state !== "loading") {
        // Descarregado/cancelado durante a carga: devolve o que chegou.
        for (const asset of loaded) {
          assets.releaseAsset(asset.url);
        }
      } else {
        this.assetsLoaded += loaded.length;
        this.assetsFailed += failed;
        this.completeLoad(record, token, loaded, failed);
      }

      this.pumpLoadQueue();
    });
  }

  private loadAsset(assets: AssetsApi, url: string): Promise<unknown> {
    switch (assetKindOf(url)) {
      case "gltf":
        return assets.loadGLTF(url);
      case "texture":
        return assets.loadTexture(url);
      case "audio":
        return assets.loadAudio(url);
      case "json":
        return assets.loadJSON(url);
      default:
        return assets.loadBinary(url);
    }
  }

  private completeLoad(record: SectorRecord, token: number, loaded: Array<{ url: string; value: unknown }>, failed: number): void {
    if (record.token !== token || record.state !== "loading") {
      return;
    }

    const elapsed = Math.max(0, this.nowMilliseconds() - record.startedAt);
    record.startedAt = 0;
    record.assets = loaded;
    record.state = "loaded";
    record.loaded = true;
    this.lastLoadTimeMs = elapsed;
    this.totalLoadTimeMs += elapsed;
    this.completedLoads += 1;
    this.ctx.events.emit(SectorLoadedEvent.type, {
      sectorCoord: copyCoord(record.descriptor.sectorCoord),
      loadedAssetsCount: loaded.length,
      loadTimeMs: elapsed,
      failedAssetsCount: failed,
      pinned: record.pinned,
    });
    this.settleWaiters(record, true);
  }

  private unloadRecord(record: SectorRecord): void {
    const wasLoaded = record.loaded;
    record.loaded = false;
    record.token += 1;
    record.startedAt = 0;

    if (record.queued) {
      record.queued = false;
      const index = this.loadQueue.indexOf(record);

      if (index >= 0) {
        this.loadQueue.splice(index, 1);
      }
    }

    record.state = "unloaded";
    this.settleWaiters(record, false);

    if (this.assets) {
      for (const asset of record.assets) {
        this.assets.releaseAsset(asset.url);
      }
    }

    record.assets = [];

    if (wasLoaded) {
      this.ctx.events.emit(SectorUnloadedEvent.type, {
        sectorCoord: copyCoord(record.descriptor.sectorCoord),
      });
    }
  }

  private settleWaiters(record: SectorRecord, loaded: boolean): void {
    if (record.waiters.length === 0) {
      return;
    }

    const waiters = record.waiters;
    record.waiters = [];

    for (const resolve of waiters) {
      resolve(loaded);
    }
  }

  private installHLOD(
    sectorCoord: SectorCoord,
    sources: ReadonlyArray<THREE.Object3D>,
    sourceKeys: ReadonlyArray<string>,
    options: HLODBuildOptions,
  ): HLODBuildResult | null {
    const render = this.render;
    const key = this.sectorManager.getSectorKey(sectorCoord);
    const sceneKey = `hlod_${key}`;
    const merged = this.hlodBuilder.merge(sources, sceneKey);

    if (render === null || merged === null) {
      return null;
    }

    this.removeHLOD(sectorCoord);
    merged.object.visible = false;
    render.addMeshToScene(sceneKey, merged.object);
    const record = this.sectorManager.getRecord(sectorCoord);
    const entry: HLODEntry = {
      key,
      sectorCoord: copyCoord(sectorCoord),
      sceneKey,
      object: merged.object,
      sourceKeys,
      hideSources: options.hideSources !== false,
      switchDistance:
        typeof options.switchDistance === "number" && Number.isFinite(options.switchDistance)
          ? Math.max(0, options.switchDistance)
          : undefined,
      maxDistance:
        typeof options.maxDistance === "number" && options.maxDistance > 0 ? options.maxDistance : Number.POSITIVE_INFINITY,
      centerX: record ? record.centerX : merged.centerX,
      centerY: record ? record.centerY : merged.centerY,
      centerZ: record ? record.centerZ : merged.centerZ,
      sourceMeshCount: merged.sourceMeshCount,
      mergedDrawCalls: merged.mergedDrawCalls,
      hiddenSources: [],
      active: false,
    };

    this.hlods.set(key, entry);
    this.updateHLOD(entry);

    return {
      sceneKey,
      sourceMeshCount: merged.sourceMeshCount,
      mergedDrawCalls: merged.mergedDrawCalls,
      vertexCount: merged.vertexCount,
      skippedMeshCount: merged.skippedMeshCount,
    };
  }

  private updateHLODs(): void {
    if (this.hlods.size === 0) {
      return;
    }

    for (const entry of this.hlods.values()) {
      this.updateHLOD(entry);
    }
  }

  private updateHLOD(entry: HLODEntry): void {
    const dx = this.centerPosition.x - entry.centerX;
    const dy = this.centerPosition.y - entry.centerY;
    const dz = this.centerPosition.z - entry.centerZ;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const switchDistance = entry.switchDistance ?? this.sectorManager.getLoadRadius();
    this.setHLODActive(entry, distance > switchDistance && distance <= entry.maxDistance);
  }

  private setHLODActive(entry: HLODEntry, active: boolean): void {
    if (entry.active === active) {
      return;
    }

    entry.active = active;
    entry.object.visible = active;

    if (!entry.hideSources) {
      return;
    }

    if (active) {
      const render = this.render;

      if (render === null) {
        return;
      }

      for (const key of entry.sourceKeys) {
        const object = render.getMeshFromScene(key);

        if (object && object.visible) {
          object.visible = false;
          entry.hiddenSources.push(object);
        }
      }

      return;
    }

    for (const object of entry.hiddenSources) {
      object.visible = true;
    }

    entry.hiddenSources.length = 0;
  }

  private retainLODAsset(entityId: string, meshUrl: string): void {
    const assets = this.assets;

    if (!assets || !meshUrl || this.lodAssets.get(entityId)?.url === meshUrl) {
      return;
    }

    this.releaseLODAsset(entityId);
    const entry = { url: meshUrl, settled: false };
    this.lodAssets.set(entityId, entry);

    void this.loadAsset(assets, meshUrl).then(
      (): void => {
        this.assetsLoaded += 1;
        entry.settled = true;

        // Trocou de nível (ou saiu) antes de terminar: devolve a referência.
        if (this.lodAssets.get(entityId) !== entry || this.disposed) {
          assets.releaseAsset(meshUrl);
        }
      },
      (): void => {
        this.assetsFailed += 1;

        if (this.lodAssets.get(entityId) === entry) {
          this.lodAssets.delete(entityId);
        }
      },
    );
  }

  /** Libera a malha retida (se a carga ainda não terminou, o próprio `then` libera). */
  private releaseLODAsset(entityId: string): void {
    const entry = this.lodAssets.get(entityId);

    if (!entry) {
      return;
    }

    this.lodAssets.delete(entityId);

    if (entry.settled) {
      this.assets?.releaseAsset(entry.url);
    }
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
