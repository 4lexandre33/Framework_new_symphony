import * as THREE from "three";

import type {
  PluginContext,
} from "@core";

import type {
  BiomeDescriptor,
  ChunkDataMatrix,
  CompiledChunkMeshBuffers,
  TerrainBlockDefinition,
  TerrainConfigOptions,
  TerrainEditsSnapshot,
  TerrainStats,
  Vector3Chunk,
  VoxelBlockData,
  VoxelModificationRequest,
} from "../../../contracts/terrain/types";

import {
  BlockModifiedEvent,
  ChunkGeneratedEvent,
  ChunkUnloadedEvent,
  TerrainResetEvent,
} from "../../../contracts/terrain/types";

import type {
  CameraApi,
} from "../../../tokens/camera";

import type {
  PhysicsApi,
} from "../../../tokens/physics";

import type {
  Render3DApi,
} from "../../../tokens/render";

import type {
  TerrainApi,
} from "../../../tokens/terrain";

import {
  BlockPalette,
} from "./BlockPalette";

import type {
  ChunkBorderSlabs,
} from "./GreedyMesher";

import {
  ProceduralWorkerPool,
  TerrainGenerationCancelledError,
} from "./ProceduralWorkerPool";

import type {
  TerrainChunkWorkerPool,
} from "./ProceduralWorkerPool";

import {
  TerrainEditStore,
} from "./TerrainEditStore";

import {
  createColumnSample,
  normalizeTerrainSeed,
  resolveGenerationConfig,
  type ColumnSample,
  type ResolvedGenerationConfig,
} from "./TerrainGenerator";

import {
  VoxelChunkManager,
  createVoxelAddress,
  type TerrainMaterials,
} from "./VoxelChunkManager";

function nowMilliseconds(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function normalizeChunkCoord(coord: Vector3Chunk): Vector3Chunk {
  return {
    x: Number.isFinite(coord.x) ? Math.trunc(coord.x) : 0,
    y: Number.isFinite(coord.y) ? Math.trunc(coord.y) : 0,
    z: Number.isFinite(coord.z) ? Math.trunc(coord.z) : 0,
  };
}

/** Prefixo dos ids de corpo físico dos chunks (`castRay` devolve `terrain_chunk_x:y:z`). */
export const TERRAIN_COLLIDER_PREFIX = "terrain_chunk_";

interface ChunkRecord {
  readonly key: string;
  readonly coord: Vector3Chunk;
  readonly renderKey: string;
  readonly colliderId: string;
  /** generating = aguardando dados; ready = dados instalados. */
  state: "generating" | "ready";
  /** Pedido manual (`requestChunk`): o streaming nunca descarrega. */
  pinned: boolean;
  /** Pedido pelo streaming automático. */
  streamed: boolean;
  meshQueued: boolean;
  rendered: boolean;
  /** `chunk-generated` já emitido (só uma vez por carga). */
  announced: boolean;
  hasCollider: boolean;
  /** Collider aguardando a física ficar pronta. */
  pendingCollision: CompiledChunkMeshBuffers | null;
  startedAt: number;
  generationTimeMs: number;
}

interface ResolvedStreaming {
  enabled: boolean;
  radiusChunks: number;
  unloadMarginChunks: number;
  verticalChunks: number[];
  maxRequestsPerUpdate: number;
  centerSource: "explicit" | "camera";
}

interface ResolvedColliders {
  enabled: boolean;
  friction: number;
  collisionGroups: { readonly memberships: number; readonly filter: number } | undefined;
}

export class TerrainService implements TerrainApi {
  private readonly records = new Map<string, ChunkRecord>();
  /** Token da geração em voo de cada chunk (respostas antigas são descartadas). */
  private readonly pendingChunkTokens = new Map<string, number>();
  private readonly meshQueue: ChunkRecord[] = [];
  private readonly collidersPending = new Set<ChunkRecord>();
  /** Chunks descarregados à mão dentro do raio: o streaming não os recarrega até saírem do raio. */
  private readonly streamingExcluded = new Map<string, Vector3Chunk>();
  private readonly editStore = new TerrainEditStore();
  private readonly palette = new BlockPalette();
  private readonly dirtyKeys = new Set<string>();
  private readonly scratchAddress = createVoxelAddress();
  private readonly columnSample: ColumnSample = createColumnSample();
  private readonly borderNegX: Uint8Array;
  private readonly borderPosX: Uint8Array;
  private readonly borderNegZ: Uint8Array;
  private readonly borderPosZ: Uint8Array;
  private readonly borderNegY: Uint8Array;
  private readonly borderPosY: Uint8Array;
  private readonly borders: ChunkBorderSlabs;
  private readonly tintGrid: Float32Array;
  private readonly coarseTint = new Float32Array(64 * 3);
  private readonly sizeX: number;
  private readonly sizeY: number;
  private readonly sizeZ: number;

  private render: Render3DApi | null = null;
  private physics: PhysicsApi | null = null;
  private camera: CameraApi | null = null;
  private materials: TerrainMaterials | null = null;
  private generationConfig: ResolvedGenerationConfig;
  private biomeTints: Readonly<Record<string, number>> | undefined;
  private generationEpoch = 1;
  private nextRequestToken = 1;
  private disposed = false;

  private readonly streaming: ResolvedStreaming = {
    enabled: false,
    radiusChunks: 4,
    unloadMarginChunks: 1,
    verticalChunks: [0],
    maxRequestsPerUpdate: 4,
    centerSource: "explicit",
  };

  // G133: colliders por chunk são opt-in (`configure({ colliders: { enabled: true } })`).
  private readonly colliders: ResolvedColliders = {
    enabled: false,
    friction: 0.8,
    collisionGroups: undefined,
  };

  private maxMeshesPerUpdate = 2;
  private meshBudgetMs = 4;
  private centerX = 0;
  private centerZ = 0;
  private hasCenter = false;
  private lastCenterChunkX = Number.NaN;
  private lastCenterChunkZ = Number.NaN;
  private streamingDirty = true;
  private spiralOffsets: Int32Array = new Int32Array(0);
  private spiralRadius = -1;

  public constructor(
    private readonly ctx: PluginContext,
    private readonly chunkManager: VoxelChunkManager = new VoxelChunkManager(),
    private readonly workerPool: TerrainChunkWorkerPool = new ProceduralWorkerPool(),
  ) {
    const sizes = chunkManager.getSizes();
    this.sizeX = sizes.sizeX;
    this.sizeY = sizes.sizeY;
    this.sizeZ = sizes.sizeZ;
    this.generationConfig = chunkManager.getGenerator().getConfig();
    this.borderNegX = new Uint8Array(this.sizeY * this.sizeZ);
    this.borderPosX = new Uint8Array(this.sizeY * this.sizeZ);
    this.borderNegZ = new Uint8Array(this.sizeY * this.sizeX);
    this.borderPosZ = new Uint8Array(this.sizeY * this.sizeX);
    this.borderNegY = new Uint8Array(this.sizeX * this.sizeZ);
    this.borderPosY = new Uint8Array(this.sizeX * this.sizeZ);
    this.borders = {
      negX: this.borderNegX,
      posX: this.borderPosX,
      negZ: this.borderNegZ,
      posZ: this.borderPosZ,
      negY: this.borderNegY,
      posY: this.borderPosY,
    };
    this.tintGrid = new Float32Array((this.sizeX + 1) * (this.sizeZ + 1) * 3);
  }

  /** `physics`/`camera` são opcionais (colliders e centro pela câmera). */
  public bindDependencies(render: Render3DApi | null, physics?: PhysicsApi | null, camera?: CameraApi | null): void {
    if (this.disposed) {
      return;
    }

    this.render = render;
    this.physics = physics ?? null;
    this.camera = camera ?? null;

    // Chunks que já tinham dados sem malha/collider entram na fila.
    for (const record of this.records.values()) {
      if (record.state === "ready" && !record.rendered) {
        this.enqueueMesh(record);
      }
    }
  }

  // ── Configuração ─────────────────────────────────────────────────────────

  public configure(options: TerrainConfigOptions): void {
    if (this.disposed) {
      return;
    }

    let remeshAll = false;

    if (options.palette) {
      for (const [id, definition] of Object.entries(options.palette)) {
        if (this.palette.setDefinition(Number(id), definition)) {
          remeshAll = true;
        }
      }
    }

    if (options.biomeTints) {
      this.biomeTints = { ...this.biomeTints, ...options.biomeTints };
      this.chunkManager.getGenerator().setBiomeTints(this.biomeTints);
      remeshAll = true;
    }

    const streaming = options.streaming;

    if (streaming) {
      const s = this.streaming;

      if (typeof streaming.enabled === "boolean") {
        s.enabled = streaming.enabled;
      }

      if (typeof streaming.radiusChunks === "number" && Number.isFinite(streaming.radiusChunks)) {
        s.radiusChunks = Math.max(0, Math.min(32, Math.floor(streaming.radiusChunks)));
      }

      if (typeof streaming.unloadMarginChunks === "number" && Number.isFinite(streaming.unloadMarginChunks)) {
        s.unloadMarginChunks = Math.max(0, Math.floor(streaming.unloadMarginChunks));
      }

      if (Array.isArray(streaming.verticalChunks) && streaming.verticalChunks.length > 0) {
        s.verticalChunks = streaming.verticalChunks.filter(Number.isInteger).map((y) => Math.trunc(y));

        if (s.verticalChunks.length === 0) {
          s.verticalChunks = [0];
        }
      }

      if (typeof streaming.maxRequestsPerUpdate === "number" && streaming.maxRequestsPerUpdate >= 1) {
        s.maxRequestsPerUpdate = Math.floor(streaming.maxRequestsPerUpdate);
      }

      if (streaming.centerSource === "camera" || streaming.centerSource === "explicit") {
        s.centerSource = streaming.centerSource;
      }

      this.streamingDirty = true;
    }

    const colliders = options.colliders;

    if (colliders) {
      if (typeof colliders.friction === "number" && Number.isFinite(colliders.friction)) {
        this.colliders.friction = Math.max(0, colliders.friction);
      }

      if (colliders.collisionGroups) {
        this.colliders.collisionGroups = {
          memberships: colliders.collisionGroups.memberships,
          filter: colliders.collisionGroups.filter,
        };
      }

      if (typeof colliders.enabled === "boolean" && colliders.enabled !== this.colliders.enabled) {
        this.colliders.enabled = colliders.enabled;

        if (!colliders.enabled) {
          for (const record of this.records.values()) {
            this.removeCollider(record);
          }
        }
      }

      remeshAll = true;
    }

    const meshing = options.meshing;

    if (meshing) {
      if (typeof meshing.maxMeshesPerUpdate === "number" && meshing.maxMeshesPerUpdate >= 1) {
        this.maxMeshesPerUpdate = Math.floor(meshing.maxMeshesPerUpdate);
      }

      if (typeof meshing.budgetMs === "number" && meshing.budgetMs >= 0) {
        this.meshBudgetMs = meshing.budgetMs;
      }
    }

    if (options.generation) {
      const next = resolveGenerationConfig(options.generation, this.generationConfig);

      if (
        next.seaLevel !== this.generationConfig.seaLevel ||
        next.caves !== this.generationConfig.caves ||
        next.caveThreshold !== this.generationConfig.caveThreshold
      ) {
        this.generationConfig = next;
        this.chunkManager.getGenerator().setConfig(next);
        // Regera os chunks carregados (mantendo a malha antiga até chegar a nova).
        this.reloadAllChunks();
        remeshAll = false;
      }
    }

    if (remeshAll) {
      this.remeshAllReady();
    }
  }

  public setBlockDefinition(blockId: number, definition: TerrainBlockDefinition): boolean {
    if (this.disposed || !this.palette.setDefinition(blockId, definition)) {
      return false;
    }

    this.remeshAllReady();
    return true;
  }

  public getBlockDefinition(blockId: number): TerrainBlockDefinition | null {
    return this.palette.getDefinition(blockId);
  }

  // ── Seed ─────────────────────────────────────────────────────────────────

  public setSeed(seed: number): void {
    if (this.disposed) {
      return;
    }

    const normalizedSeed = normalizeTerrainSeed(seed);
    const previousSeed = this.chunkManager.getSeed();

    if (normalizedSeed === previousSeed) {
      return;
    }

    const unloadedChunks = this.countWorldChunks();
    const discardedEdits = this.editStore.clear();
    this.clearInternal();
    this.chunkManager.setSeed(normalizedSeed);

    // G55: trocar de mundo nunca mais é silencioso.
    if (unloadedChunks > 0 || discardedEdits > 0) {
      this.ctx.events.emit(TerrainResetEvent.type, {
        reason: "seed-changed",
        previousSeed,
        seed: normalizedSeed,
        unloadedChunks,
        discardedEdits,
      });
    }
  }

  public getSeed(): number {
    return this.chunkManager.getSeed();
  }

  /** true se há chunks (carregados ou em geração) ou edições: trocar de seed descartaria algo. */
  public hasWorldContent(): boolean {
    return this.countWorldChunks() > 0 || this.editStore.size > 0;
  }

  // ── Chunks ───────────────────────────────────────────────────────────────

  public requestChunk(chunkCoord: Vector3Chunk): void {
    if (this.disposed) {
      return;
    }

    const coord = normalizeChunkCoord(chunkCoord);
    const key = this.chunkManager.getChunkKey(coord);
    this.streamingExcluded.delete(key);
    const existing = this.records.get(key);

    if (existing) {
      // G56: idempotente — não remonta nem reemite `chunk-generated`.
      existing.pinned = true;

      if (existing.state === "ready" && !existing.rendered && !existing.meshQueued && !existing.announced) {
        this.enqueueMesh(existing);
      }

      return;
    }

    const record = this.createRecord(coord, key);
    record.pinned = true;

    // Dados já instalados por outro caminho (ex.: generateChunkData).
    if (this.chunkManager.getChunkDataByKey(key) !== null) {
      record.state = "ready";
      this.enqueueMesh(record);
      return;
    }

    this.startGeneration(record);
  }

  /** true quando o chunk tem dados e já foi montado (malha/collider). */
  public isChunkReady(chunkCoord: Vector3Chunk): boolean {
    const record = this.records.get(this.chunkManager.getChunkKey(normalizeChunkCoord(chunkCoord)));
    return record !== undefined && record.state === "ready" && record.announced;
  }

  public unloadChunk(chunkCoord: Vector3Chunk): boolean {
    const coord = normalizeChunkCoord(chunkCoord);
    const key = this.chunkManager.getChunkKey(coord);
    const record = this.records.get(key);

    if (!record) {
      return this.chunkManager.unloadChunk(coord);
    }

    if (this.streaming.enabled) {
      // Descarga manual é respeitada: o streaming não recarrega enquanto estiver no raio.
      this.streamingExcluded.set(key, record.coord);
    }

    this.unloadRecord(record);
    return true;
  }

  public getVoxelBlock(worldPos: Vector3Chunk): VoxelBlockData {
    return this.chunkManager.getVoxelBlock(worldPos);
  }

  public modifyVoxelBlock(request: VoxelModificationRequest): boolean {
    return this.applyModifications(request, null) > 0;
  }

  /** G18: aplica o lote e remonta cada chunk afetado UMA vez. Retorna quantas escritas valeram. */
  public modifyVoxelBlocks(requests: ReadonlyArray<VoxelModificationRequest>): number {
    return this.applyModifications(null, requests);
  }

  public getBiomeAt(worldPos: Vector3Chunk): BiomeDescriptor {
    return this.chunkManager.getBiomeAt(worldPos);
  }

  /**
   * Y do bloco sólido mais alto da coluna (com edições se o chunk estiver
   * carregado; senão a altura gerada). -1 se a coluna carregada estiver vazia.
   */
  public getSurfaceHeight(worldX: number, worldZ: number): number {
    const generator = this.chunkManager.getGenerator();
    const address = this.chunkManager.resolveAddress(worldX, 0, worldZ, this.scratchAddress);
    let loadedTop = Number.NEGATIVE_INFINITY;
    let foundLoaded = false;

    for (const record of this.records.values()) {
      if (record.state !== "ready" || record.coord.x !== address.chunkX || record.coord.z !== address.chunkZ) {
        continue;
      }

      const data = this.chunkManager.getChunkDataByKey(record.key);

      if (!data) {
        continue;
      }

      foundLoaded = true;
      const columnBase = address.localX + this.sizeX * address.localZ;
      const layer = this.sizeX * this.sizeZ;

      for (let y = this.sizeY - 1; y >= 0; y -= 1) {
        const id = data.blocks[columnBase + layer * y] ?? 0;

        if (id !== 0 && this.palette.solid[id] === 1) {
          loadedTop = Math.max(loadedTop, record.coord.y * this.sizeY + y);
          break;
        }
      }
    }

    if (foundLoaded) {
      return Number.isFinite(loadedTop) ? loadedTop : -1;
    }

    return generator.sampleColumn(Math.floor(worldX), Math.floor(worldZ), this.columnSample).height;
  }

  public getActiveChunkCount(): number {
    return this.chunkManager.getActiveChunkCount();
  }

  // ── Streaming ────────────────────────────────────────────────────────────

  public setStreamingCenter(position: Vector3Chunk): void {
    this.writeStreamingCenter(position.x, position.y, position.z);
  }

  /**
   * Tick: atualiza o centro (argumento > câmera > último explícito), carrega
   * e descarrega chunks do streaming, tenta colliders pendentes e monta
   * malhas dentro do orçamento.
   */
  public update(_deltaSeconds: number, playerPosition?: Vector3Chunk): void {
    if (this.disposed) {
      return;
    }

    if (playerPosition !== undefined) {
      this.writeStreamingCenter(playerPosition.x, playerPosition.y, playerPosition.z);
    } else {
      this.pullCameraCenter();
    }

    this.updateStreaming();
    this.retryPendingColliders();
    this.processMeshQueue();
  }

  /** Monta malhas da fila dentro do orçamento (`meshing`). Retorna quantas montou. */
  public processMeshQueue(): number {
    if (this.disposed || this.meshQueue.length === 0) {
      return 0;
    }

    const startedAt = nowMilliseconds();
    let processed = 0;

    while (this.meshQueue.length > 0 && processed < this.maxMeshesPerUpdate) {
      if (processed > 0 && nowMilliseconds() - startedAt >= this.meshBudgetMs) {
        break;
      }

      const record = this.takeNextMeshRecord();

      if (record === null) {
        break;
      }

      record.meshQueued = false;

      if (record.state === "ready" && this.records.get(record.key) === record) {
        this.meshRecord(record);
        processed += 1;
      }
    }

    return processed;
  }

  // ── Edições persistentes (G56) ───────────────────────────────────────────

  public exportEdits(): TerrainEditsSnapshot {
    return this.editStore.export(this.chunkManager.getSeed());
  }

  /**
   * Importa edições (validação atômica). Se a seed do snapshot difere, troca
   * de mundo (emite `game.terrain.reset`). `replace` (padrão true) descarta as
   * edições atuais. Chunks carregados são regerados com as edições.
   */
  public importEdits(snapshot: TerrainEditsSnapshot, options?: { readonly replace?: boolean }): boolean {
    if (this.disposed) {
      return false;
    }

    const volume = this.sizeX * this.sizeY * this.sizeZ;
    const validated = TerrainEditStore.validate(snapshot, volume, (coord) => this.chunkManager.getChunkKey(coord));

    if (validated === null) {
      return false;
    }

    this.setSeed(snapshot.seed);
    const replace = options?.replace !== false;
    let discarded = 0;

    if (replace) {
      discarded = this.editStore.clear();
    }

    for (const chunk of validated) {
      for (let i = 0; i < chunk.edits.length; i += 3) {
        this.editStore.record(
          chunk.key,
          chunk.coord,
          chunk.edits[i] as number,
          chunk.edits[i + 1] as number,
          chunk.edits[i + 2] as number,
        );
      }
    }

    this.reloadAllChunks();

    if (discarded > 0) {
      this.ctx.events.emit(TerrainResetEvent.type, {
        reason: "edits-imported",
        previousSeed: this.chunkManager.getSeed(),
        seed: this.chunkManager.getSeed(),
        unloadedChunks: 0,
        discardedEdits: discarded,
      });
    }

    return true;
  }

  public clearEdits(): number {
    const discarded = this.editStore.clear();

    if (discarded > 0) {
      this.reloadAllChunks();
    }

    return discarded;
  }

  public getStats(): TerrainStats {
    let rendered = 0;
    let colliders = 0;

    for (const record of this.records.values()) {
      if (record.rendered) {
        rendered += 1;
      }

      if (record.hasCollider) {
        colliders += 1;
      }
    }

    return {
      loadedChunks: this.chunkManager.getActiveChunkCount(),
      renderedChunks: rendered,
      pendingGenerations: this.pendingChunkTokens.size,
      queuedMeshes: this.meshQueue.length,
      colliders,
      editedVoxels: this.editStore.size,
      streamingEnabled: this.streaming.enabled,
    };
  }

  /**
   * Descarrega TODOS os chunks (malhas, colliders) e emite `game.terrain.reset`
   * (reason "clear"). As edições persistentes são mantidas (reaplicadas ao
   * recarregar); use `clearEdits()` para apagá-las.
   */
  public clear(): void {
    const unloadedChunks = this.countWorldChunks();
    this.clearInternal();

    if (unloadedChunks > 0 && !this.disposed) {
      const seed = this.chunkManager.getSeed();
      this.ctx.events.emit(TerrainResetEvent.type, {
        reason: "clear",
        previousSeed: seed,
        seed,
        unloadedChunks,
        discardedEdits: 0,
      });
    }
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.clearInternal();
    this.disposed = true;
    this.workerPool.clear();

    if (this.materials !== null) {
      this.materials.opaque.dispose();
      this.materials.transparent.dispose();
      this.materials = null;
    }

    this.render = null;
    this.physics = null;
    this.camera = null;
  }

  // ── Internos ─────────────────────────────────────────────────────────────

  private countWorldChunks(): number {
    let count = this.chunkManager.getActiveChunkCount();

    for (const record of this.records.values()) {
      if (record.state === "generating") {
        count += 1;
      }
    }

    return count;
  }

  private clearInternal(): void {
    this.generationEpoch += 1;
    this.pendingChunkTokens.clear();

    for (const record of this.records.values()) {
      this.removeRenderAndCollider(record);
    }

    this.records.clear();
    this.meshQueue.length = 0;
    this.collidersPending.clear();
    this.streamingExcluded.clear();
    this.chunkManager.clear();
    this.streamingDirty = true;
  }

  private createRecord(coord: Vector3Chunk, key: string): ChunkRecord {
    const record: ChunkRecord = {
      key,
      coord,
      renderKey: `chunk_${key}`,
      colliderId: `${TERRAIN_COLLIDER_PREFIX}${key}`,
      state: "generating",
      pinned: false,
      streamed: false,
      meshQueued: false,
      rendered: false,
      announced: false,
      hasCollider: false,
      pendingCollision: null,
      startedAt: nowMilliseconds(),
      generationTimeMs: 0,
    };

    this.records.set(key, record);
    return record;
  }

  private startGeneration(record: ChunkRecord): void {
    const requestToken = this.allocateRequestToken();
    const requestEpoch = this.generationEpoch;
    const renderKey = record.key;
    this.pendingChunkTokens.set(renderKey, requestToken);
    record.startedAt = nowMilliseconds();

    void this.workerPool
      .requestChunkGenerationAsync(record.coord, this.getSeed(), this.generationConfig)
      .then((chunkData): void => {
        if (this.disposed || !this.isRequestCurrent(renderKey, requestToken, requestEpoch)) {
          return;
        }

        this.pendingChunkTokens.delete(renderKey);
        this.installGenerated(record, chunkData);
      })
      .catch((error: unknown): void => {
        if (!this.isRequestCurrent(renderKey, requestToken, requestEpoch)) {
          // Cancelado/obsoleto/teardown: descartado.
          return;
        }

        this.pendingChunkTokens.delete(renderKey);

        if (error instanceof TerrainGenerationCancelledError || this.disposed) {
          return;
        }

        this.ctx.log?.error?.("terrain: falha ao gerar chunk", {
          chunk: record.key,
          error: error instanceof Error ? error.message : String(error),
        });

        if (record.state === "generating" && this.records.get(record.key) === record) {
          this.records.delete(record.key);
        }
      });
  }

  private installGenerated(record: ChunkRecord, chunkData: ChunkDataMatrix): void {
    if (this.records.get(record.key) !== record) {
      return;
    }

    this.chunkManager.installChunkData(chunkData);
    const metadata = this.editStore.chunkHasMetadata(record.key)
      ? this.chunkManager.getMetadataArray(record.key, true)
      : this.chunkManager.getMetadataArray(record.key, false);

    if (metadata) {
      metadata.fill(0);
    }

    this.editStore.applyTo(record.key, chunkData.blocks, metadata);
    record.state = "ready";
    record.generationTimeMs = Math.max(0, nowMilliseconds() - record.startedAt);
    this.enqueueMesh(record);
  }

  /** Regera dados de todos os chunks (edições/geração mudaram) mantendo a malha atual até a nova. */
  private reloadAllChunks(): void {
    for (const record of this.records.values()) {
      this.startGeneration(record);
    }
  }

  private unloadRecord(record: ChunkRecord): void {
    const wasReady = record.state === "ready";

    if (this.pendingChunkTokens.has(record.key)) {
      this.pendingChunkTokens.delete(record.key);
      this.workerPool.cancelChunkGeneration?.(record.coord, this.getSeed());
    }

    this.removeFromMeshQueue(record);
    this.removeRenderAndCollider(record);
    this.records.delete(record.key);
    this.chunkManager.unloadChunk(record.coord);

    if (wasReady && !this.disposed) {
      this.ctx.events.emit(ChunkUnloadedEvent.type, {
        chunkCoord: { x: record.coord.x, y: record.coord.y, z: record.coord.z },
      });
    }
  }

  private removeRenderAndCollider(record: ChunkRecord): void {
    if (record.rendered && this.render !== null) {
      this.render.removeMeshFromScene(record.renderKey);
    }

    record.rendered = false;
    this.removeCollider(record);
  }

  private removeCollider(record: ChunkRecord): void {
    if (record.hasCollider && this.physics !== null) {
      this.physics.removeBody(record.colliderId);
    }

    record.hasCollider = false;
    record.pendingCollision = null;
    this.collidersPending.delete(record);
  }

  private enqueueMesh(record: ChunkRecord): void {
    if (record.meshQueued) {
      return;
    }

    record.meshQueued = true;
    this.meshQueue.push(record);
  }

  private removeFromMeshQueue(record: ChunkRecord): void {
    if (!record.meshQueued) {
      return;
    }

    const index = this.meshQueue.indexOf(record);

    if (index >= 0) {
      this.meshQueue.splice(index, 1);
    }

    record.meshQueued = false;
  }

  /** Mais próximo do centro de streaming primeiro (FIFO sem centro). */
  private takeNextMeshRecord(): ChunkRecord | null {
    const queue = this.meshQueue;

    if (queue.length === 0) {
      return null;
    }

    let bestIndex = 0;

    if (this.hasCenter && queue.length > 1) {
      let bestDistance = Number.POSITIVE_INFINITY;
      const cx = this.centerX / this.sizeX - 0.5;
      const cz = this.centerZ / this.sizeZ - 0.5;

      for (let index = 0; index < queue.length; index += 1) {
        const record = queue[index] as ChunkRecord;
        const dx = record.coord.x - cx;
        const dz = record.coord.z - cz;
        const distance = dx * dx + dz * dz;

        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      }
    }

    const [record] = queue.splice(bestIndex, 1);
    return record ?? null;
  }

  private remeshAllReady(): void {
    for (const record of this.records.values()) {
      if (record.state === "ready" && record.announced) {
        this.enqueueMesh(record);
      }
    }
  }

  private ensureMaterials(): TerrainMaterials {
    if (this.materials === null) {
      const opaque = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.FrontSide });
      const transparent = new THREE.MeshLambertMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      // Compartilhados entre chunks: o render não deve liberá-los ao remover um chunk.
      opaque.userData.renderRetain = true;
      transparent.userData.renderRetain = true;
      this.materials = { opaque, transparent };
    }

    return this.materials;
  }

  private meshRecord(record: ChunkRecord): void {
    const data = this.chunkManager.getChunkDataByKey(record.key);

    if (data === null) {
      return;
    }

    const render = this.render;
    const wantsCollider = this.physics !== null && this.colliders.enabled;

    if (render !== null || wantsCollider) {
      this.fillBorders(record.coord);
      this.fillTintGrid(record.coord);
      const compiled = this.chunkManager.compileChunkMesh(data, {
        palette: this.palette,
        borders: this.borders,
        tintGrid: this.tintGrid,
        collision: wantsCollider,
      });

      if (render !== null) {
        const object = this.chunkManager.buildChunkObject(data, compiled, this.ensureMaterials());

        if (object.children.length > 0) {
          render.addMeshToScene(record.renderKey, object);
          record.rendered = true;
        } else if (record.rendered) {
          render.removeMeshFromScene(record.renderKey);
          record.rendered = false;
        }
      }

      if (wantsCollider) {
        this.updateCollider(record, compiled);
      }

      if (!record.announced) {
        record.announced = true;
        this.emitChunkGenerated(record, (compiled.positions.length + (compiled.transparentPositions?.length ?? 0)) / 3);
      }

      return;
    }

    if (!record.announced) {
      record.announced = true;
      this.emitChunkGenerated(record, 0);
    }
  }

  private emitChunkGenerated(record: ChunkRecord, totalVertices: number): void {
    this.ctx.events.emit(ChunkGeneratedEvent.type, {
      chunkCoord: { x: record.coord.x, y: record.coord.y, z: record.coord.z },
      totalVertices,
      generationTimeMs: record.generationTimeMs,
    });
  }

  private updateCollider(record: ChunkRecord, compiled: CompiledChunkMeshBuffers): void {
    const physics = this.physics;

    if (physics === null) {
      return;
    }

    const vertices = compiled.collisionPositions;
    const indices = compiled.collisionIndices;

    if (!vertices || !indices || indices.length === 0) {
      this.removeCollider(record);
      return;
    }

    const created = physics.createBody(
      record.colliderId,
      {
        bodyType: "fixed",
        position: {
          x: record.coord.x * this.sizeX,
          y: record.coord.y * this.sizeY,
          z: record.coord.z * this.sizeZ,
        },
      },
      {
        shapeType: "trimesh",
        vertices,
        indices,
        friction: this.colliders.friction,
        ...(this.colliders.collisionGroups ? { collisionGroups: this.colliders.collisionGroups } : {}),
      },
    );

    if (created) {
      record.hasCollider = true;
      record.pendingCollision = null;
      this.collidersPending.delete(record);
      return;
    }

    // Física ainda não pronta (WASM carregando): tenta de novo nos próximos updates.
    record.pendingCollision = compiled;
    this.collidersPending.add(record);
  }

  private retryPendingColliders(): void {
    if (this.collidersPending.size === 0 || this.physics === null) {
      return;
    }

    for (const record of this.collidersPending) {
      const compiled = record.pendingCollision;

      if (compiled === null || this.records.get(record.key) !== record) {
        this.collidersPending.delete(record);
        continue;
      }

      this.updateCollider(record, compiled);

      if (record.pendingCollision !== null) {
        // Física continua indisponível: não insiste com os demais neste update.
        return;
      }
    }
  }

  /** Preenche as fatias vizinhas: chunk carregado se houver, senão gerador + edições. */
  private fillBorders(coord: Vector3Chunk): void {
    const sx = this.sizeX;
    const sy = this.sizeY;
    const sz = this.sizeZ;
    const generator = this.chunkManager.getGenerator();
    const sample = this.columnSample;
    const baseX = coord.x * sx;
    const baseY = coord.y * sy;
    const baseZ = coord.z * sz;

    // -X / +X: índice y * sz + z
    for (let side = 0; side < 2; side += 1) {
      const out = side === 0 ? this.borderNegX : this.borderPosX;
      const neighborX = coord.x + (side === 0 ? -1 : 1);
      const localX = side === 0 ? sx - 1 : 0;
      const neighbor = this.chunkManager.getChunkDataByKey(this.chunkManager.getChunkKeyXYZ(neighborX, coord.y, coord.z));

      if (neighbor) {
        for (let y = 0; y < sy; y += 1) {
          for (let z = 0; z < sz; z += 1) {
            out[y * sz + z] = neighbor.blocks[localX + sx * (z + sz * y)] ?? 0;
          }
        }
      } else {
        const worldX = baseX + (side === 0 ? -1 : sx);

        for (let z = 0; z < sz; z += 1) {
          generator.fillColumn(worldX, baseZ + z, baseY, sy, out, z, sz, sample);
        }

        this.overlayBorder(neighborX, coord.y, coord.z, out, 0, localX);
      }
    }

    // -Z / +Z: índice y * sx + x
    for (let side = 0; side < 2; side += 1) {
      const out = side === 0 ? this.borderNegZ : this.borderPosZ;
      const neighborZ = coord.z + (side === 0 ? -1 : 1);
      const localZ = side === 0 ? sz - 1 : 0;
      const neighbor = this.chunkManager.getChunkDataByKey(this.chunkManager.getChunkKeyXYZ(coord.x, coord.y, neighborZ));

      if (neighbor) {
        for (let y = 0; y < sy; y += 1) {
          for (let x = 0; x < sx; x += 1) {
            out[y * sx + x] = neighbor.blocks[x + sx * (localZ + sz * y)] ?? 0;
          }
        }
      } else {
        const worldZ = baseZ + (side === 0 ? -1 : sz);

        for (let x = 0; x < sx; x += 1) {
          generator.fillColumn(baseX + x, worldZ, baseY, sy, out, x, sx, sample);
        }

        this.overlayBorder(coord.x, coord.y, neighborZ, out, 2, localZ);
      }
    }

    // -Y / +Y: índice z * sx + x
    for (let side = 0; side < 2; side += 1) {
      const out = side === 0 ? this.borderNegY : this.borderPosY;
      const neighborY = coord.y + (side === 0 ? -1 : 1);
      const localY = side === 0 ? sy - 1 : 0;
      const neighbor = this.chunkManager.getChunkDataByKey(this.chunkManager.getChunkKeyXYZ(coord.x, neighborY, coord.z));
      const layer = sx * sz;

      if (neighbor) {
        out.set(neighbor.blocks.subarray(localY * layer, localY * layer + layer));
      } else {
        const worldY = side === 0 ? baseY - 1 : baseY + sy;
        const uniform = generator.uniformBlockAtY(worldY);

        if (uniform >= 0) {
          out.fill(uniform);
          this.overlayBorder(coord.x, neighborY, coord.z, out, 1, localY);
          continue;
        }

        for (let z = 0; z < sz; z += 1) {
          for (let x = 0; x < sx; x += 1) {
            generator.fillColumn(baseX + x, baseZ + z, worldY, 1, out, z * sx + x, 1, sample);
          }
        }

        this.overlayBorder(coord.x, neighborY, coord.z, out, 1, localY);
      }
    }
  }

  /** Aplica edições persistentes de um vizinho NÃO carregado à fatia de borda. */
  private overlayBorder(cx: number, cy: number, cz: number, out: Uint8Array, axis: number, plane: number): void {
    const key = this.chunkManager.getChunkKeyXYZ(cx, cy, cz);

    if (!this.editStore.hasChunk(key)) {
      return;
    }

    const sx = this.sizeX;
    const sy = this.sizeY;
    const sz = this.sizeZ;

    if (axis === 0) {
      for (let y = 0; y < sy; y += 1) {
        for (let z = 0; z < sz; z += 1) {
          const packed = this.editStore.get(key, plane + sx * (z + sz * y));

          if (packed !== undefined) {
            out[y * sz + z] = packed & 0xff;
          }
        }
      }
    } else if (axis === 2) {
      for (let y = 0; y < sy; y += 1) {
        for (let x = 0; x < sx; x += 1) {
          const packed = this.editStore.get(key, x + sx * (plane + sz * y));

          if (packed !== undefined) {
            out[y * sx + x] = packed & 0xff;
          }
        }
      }
    } else {
      for (let z = 0; z < sz; z += 1) {
        for (let x = 0; x < sx; x += 1) {
          const packed = this.editStore.get(key, x + sx * (z + sz * plane));

          if (packed !== undefined) {
            out[z * sx + x] = packed & 0xff;
          }
        }
      }
    }
  }

  /**
   * Tom do bioma por vértice de coluna. O clima varia devagar (escala ~200
   * blocos): amostra a cada 4 blocos e interpola (25 amostras, não 289).
   */
  private fillTintGrid(coord: Vector3Chunk): void {
    const generator = this.chunkManager.getGenerator();
    const sample = this.columnSample;
    const baseX = coord.x * this.sizeX;
    const baseZ = coord.z * this.sizeZ;
    const stride = this.sizeX + 1;
    const step = 4;
    const coarse = this.coarseTint;
    const coarseX = Math.floor(this.sizeX / step) + 1;
    const coarseZ = Math.floor(this.sizeZ / step) + 1;

    for (let cz = 0; cz < coarseZ; cz += 1) {
      for (let cx = 0; cx < coarseX; cx += 1) {
        generator.sampleColumn(baseX + Math.min(this.sizeX, cx * step), baseZ + Math.min(this.sizeZ, cz * step), sample);
        const index = (cz * coarseX + cx) * 3;
        coarse[index] = sample.tintR;
        coarse[index + 1] = sample.tintG;
        coarse[index + 2] = sample.tintB;
      }
    }

    for (let z = 0; z <= this.sizeZ; z += 1) {
      const gz = Math.min(coarseZ - 2, Math.floor(z / step));
      const fz = Math.min(1, (z - gz * step) / step);

      for (let x = 0; x <= this.sizeX; x += 1) {
        const gx = Math.min(coarseX - 2, Math.floor(x / step));
        const fx = Math.min(1, (x - gx * step) / step);
        const i00 = (gz * coarseX + gx) * 3;
        const i10 = i00 + 3;
        const i01 = i00 + coarseX * 3;
        const i11 = i01 + 3;
        const index = (z * stride + x) * 3;

        for (let channel = 0; channel < 3; channel += 1) {
          const top = (coarse[i00 + channel] as number) * (1 - fx) + (coarse[i10 + channel] as number) * fx;
          const bottom = (coarse[i01 + channel] as number) * (1 - fx) + (coarse[i11 + channel] as number) * fx;
          this.tintGrid[index + channel] = top * (1 - fz) + bottom * fz;
        }
      }
    }
  }

  private applyModifications(
    single: VoxelModificationRequest | null,
    batch: ReadonlyArray<VoxelModificationRequest> | null,
  ): number {
    if (this.disposed) {
      return 0;
    }

    const dirty = this.dirtyKeys;
    dirty.clear();
    let applied = 0;
    const count = single !== null ? 1 : batch?.length ?? 0;

    for (let index = 0; index < count; index += 1) {
      const request = single ?? (batch as ReadonlyArray<VoxelModificationRequest>)[index];

      if (!request || typeof request !== "object" || !request.worldPosition) {
        continue;
      }

      const address = this.scratchAddress;
      const previous = this.chunkManager.setVoxel(request, address);

      if (previous === -1) {
        continue;
      }

      applied += 1;
      const key = this.chunkManager.getChunkKeyXYZ(address.chunkX, address.chunkY, address.chunkZ);
      this.editStore.record(
        key,
        { x: address.chunkX, y: address.chunkY, z: address.chunkZ },
        address.index,
        request.newBlockId,
        request.newMetadata ?? 0,
      );

      if (previous === request.newBlockId) {
        continue;
      }

      dirty.add(key);

      // Bordas: a face do vizinho também muda.
      if (address.localX === 0) dirty.add(this.chunkManager.getChunkKeyXYZ(address.chunkX - 1, address.chunkY, address.chunkZ));
      if (address.localX === this.sizeX - 1) dirty.add(this.chunkManager.getChunkKeyXYZ(address.chunkX + 1, address.chunkY, address.chunkZ));
      if (address.localZ === 0) dirty.add(this.chunkManager.getChunkKeyXYZ(address.chunkX, address.chunkY, address.chunkZ - 1));
      if (address.localZ === this.sizeZ - 1) dirty.add(this.chunkManager.getChunkKeyXYZ(address.chunkX, address.chunkY, address.chunkZ + 1));
      if (address.localY === 0) dirty.add(this.chunkManager.getChunkKeyXYZ(address.chunkX, address.chunkY - 1, address.chunkZ));
      if (address.localY === this.sizeY - 1) dirty.add(this.chunkManager.getChunkKeyXYZ(address.chunkX, address.chunkY + 1, address.chunkZ));

      const position = request.worldPosition;
      this.ctx.events.emit(BlockModifiedEvent.type, {
        worldPosition: { x: position.x, y: position.y, z: position.z },
        oldBlockId: previous,
        newBlockId: request.newBlockId,
      });
    }

    // Uma remontagem por chunk afetado (síncrona: malha/collider refletem a edição já).
    for (const key of dirty) {
      const record = this.records.get(key);

      if (!record || record.state !== "ready") {
        continue;
      }

      if (record.announced) {
        this.removeFromMeshQueue(record);
        this.meshRecord(record);
      }
    }

    dirty.clear();
    return applied;
  }

  private writeStreamingCenter(x: number, y: number, z: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return;
    }

    this.centerX = x;
    this.centerZ = z;
    this.hasCenter = true;
  }

  private pullCameraCenter(): void {
    if (this.streaming.centerSource !== "camera" || this.camera === null) {
      return;
    }

    const snapshot = this.camera.getCurrentCameraSnapshot();

    if (snapshot !== null) {
      this.writeStreamingCenter(snapshot.position.x, snapshot.position.y, snapshot.position.z);
    }
  }

  private updateStreaming(): void {
    const streaming = this.streaming;

    if (!streaming.enabled || !this.hasCenter) {
      return;
    }

    const centerChunkX = Math.floor(Math.floor(this.centerX) / this.sizeX);
    const centerChunkZ = Math.floor(Math.floor(this.centerZ) / this.sizeZ);

    if (
      !this.streamingDirty &&
      centerChunkX === this.lastCenterChunkX &&
      centerChunkZ === this.lastCenterChunkZ
    ) {
      return;
    }

    this.lastCenterChunkX = centerChunkX;
    this.lastCenterChunkZ = centerChunkZ;
    this.streamingDirty = false;
    const radius = streaming.radiusChunks;
    const unloadRadius = radius + streaming.unloadMarginChunks;
    const unloadSquared = unloadRadius * unloadRadius;

    // Descarga: só chunks do streaming (os pedidos à mão ficam fixados).
    for (const record of this.records.values()) {
      if (!record.streamed) {
        continue;
      }

      const dx = record.coord.x - centerChunkX;
      const dz = record.coord.z - centerChunkZ;

      if (dx * dx + dz * dz <= unloadSquared) {
        continue;
      }

      if (record.pinned) {
        record.streamed = false;
      } else {
        this.unloadRecord(record);
      }
    }

    for (const [key, coord] of this.streamingExcluded) {
      const dx = coord.x - centerChunkX;
      const dz = coord.z - centerChunkZ;

      if (dx * dx + dz * dz > unloadSquared) {
        this.streamingExcluded.delete(key);
      }
    }

    // Carga em espiral (mais perto primeiro), limitada por update.
    this.ensureSpiral(radius);
    const offsets = this.spiralOffsets;
    let requests = 0;

    for (let index = 0; index < offsets.length; index += 2) {
      const chunkX = centerChunkX + (offsets[index] as number);
      const chunkZ = centerChunkZ + (offsets[index + 1] as number);

      for (let layer = 0; layer < streaming.verticalChunks.length; layer += 1) {
        const chunkY = streaming.verticalChunks[layer] as number;
        const key = this.chunkManager.getChunkKeyXYZ(chunkX, chunkY, chunkZ);
        const existing = this.records.get(key);

        if (existing) {
          existing.streamed = true;
          continue;
        }

        if (this.streamingExcluded.has(key)) {
          continue;
        }

        if (requests >= streaming.maxRequestsPerUpdate) {
          this.streamingDirty = true;
          return;
        }

        const record = this.createRecord({ x: chunkX, y: chunkY, z: chunkZ }, key);
        record.streamed = true;
        this.startGeneration(record);
        requests += 1;
      }
    }
  }

  private ensureSpiral(radius: number): void {
    if (this.spiralRadius === radius) {
      return;
    }

    const cells: Array<[number, number, number]> = [];

    for (let dz = -radius; dz <= radius; dz += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const distance = dx * dx + dz * dz;

        if (distance <= radius * radius) {
          cells.push([dx, dz, distance]);
        }
      }
    }

    cells.sort((a, b) => a[2] - b[2]);
    const offsets = new Int32Array(cells.length * 2);

    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index] as [number, number, number];
      offsets[index * 2] = cell[0];
      offsets[index * 2 + 1] = cell[1];
    }

    this.spiralOffsets = offsets;
    this.spiralRadius = radius;
  }

  private allocateRequestToken(): number {
    const token = this.nextRequestToken;
    this.nextRequestToken += 1;

    if (this.nextRequestToken >= Number.MAX_SAFE_INTEGER) {
      this.nextRequestToken = 1;
    }

    return token;
  }

  private isRequestCurrent(key: string, requestToken: number, requestEpoch: number): boolean {
    return requestEpoch === this.generationEpoch && this.pendingChunkTokens.get(key) === requestToken;
  }
}
