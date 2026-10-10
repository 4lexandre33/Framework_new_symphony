import { defineEvent, defineCommand } from "@core";

export interface Vector3Chunk {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface VoxelBlockData {
  readonly id: number; // 0 = Ar, 1 = Terra, 2 = Pedra, 3 = Grama, 4 = Areia, 5 = Neve, 6 = Madeira, 7 = Água, 8 = Vidro
  /** Byte livre por voxel (0–255) definido pelo jogo (`modifyVoxelBlock({ newMetadata })`). Ausente quando 0. */
  readonly metadata?: number;
}

export interface BiomeDescriptor {
  readonly biomeId: string;
  readonly name: string;
  readonly surfaceBlockId: number;
  readonly subSurfaceBlockId: number;
  readonly minHeight: number;
  readonly maxHeight: number;
  readonly temperature: number; // 0.0 (Frio) a 1.0 (Quente)
  readonly moisture: number;    // 0.0 (Seco) a 1.0 (Úmido)
}

export interface ChunkDataMatrix {
  readonly coord: Vector3Chunk;
  readonly sizeX: number; // 16
  readonly sizeY: number; // 256 (TERRAIN_CHUNK_SIZE_Y)
  readonly sizeZ: number; // 16
  /** Índice = x + sizeX * (z + sizeZ * y). */
  readonly blocks: Uint8Array;
}

/** Dimensões reais de um chunk (G59): 16 × 256 × 16; a malha fica em (x*16, y*256, z*16). */
export const TERRAIN_CHUNK_SIZE_X = 16;
export const TERRAIN_CHUNK_SIZE_Y = 256;
export const TERRAIN_CHUNK_SIZE_Z = 16;

/** Ids de bloco da paleta padrão. */
export const TerrainBlockIds = Object.freeze({
  AIR: 0,
  DIRT: 1,
  STONE: 2,
  GRASS: 3,
  SAND: 4,
  SNOW: 5,
  WOOD: 6,
  WATER: 7,
  GLASS: 8,
} as const);

export interface VoxelModificationRequest {
  readonly worldPosition: Vector3Chunk;
  readonly newBlockId: number;
  /** Metadata (0–255) do voxel. Omitido = 0. */
  readonly newMetadata?: number;
}

/** Aparência/física de um id de bloco (paleta). */
export interface TerrainBlockDefinition {
  readonly name?: string;
  /** Cor RGB (0xRRGGBB). */
  readonly color: number;
  /** Desenhado na malha transparente (água, vidro). Padrão false. */
  readonly transparent?: boolean;
  /** Opacidade (0–1) quando `transparent`. Padrão 0.6. */
  readonly opacity?: number;
  /** Entra no collider físico. Padrão true (false para líquidos). */
  readonly solid?: boolean;
  /** Multiplica a cor pelo tom do bioma (grama/folhas). Padrão false. */
  readonly tintByBiome?: boolean;
}

export interface TerrainStreamingOptions {
  /** Liga o carregamento automático de chunks em volta do centro. Padrão false. */
  readonly enabled?: boolean;
  /** Raio em chunks (distância XZ entre colunas). Padrão 4. */
  readonly radiusChunks?: number;
  /** Margem extra (chunks) antes de descarregar (histerese). Padrão 1. */
  readonly unloadMarginChunks?: number;
  /** Camadas verticais (coord.y) carregadas por coluna. Padrão [0] (0..255 cobre todos os biomas). */
  readonly verticalChunks?: ReadonlyArray<number>;
  /** Máximo de chunks novos pedidos por update. Padrão 4. */
  readonly maxRequestsPerUpdate?: number;
  /** "explicit" = `setStreamingCenter`/`update(dt, pos)`; "camera" = câmera ativa de `game.camera`. Padrão "explicit". */
  readonly centerSource?: "explicit" | "camera";
}

export interface TerrainColliderOptions {
  /** Cria colliders (trimesh por chunk) quando `game.physics` existe. Padrão true. */
  readonly enabled?: boolean;
  readonly friction?: number;
  readonly collisionGroups?: { readonly memberships: number; readonly filter: number };
}

export interface TerrainGenerationOptions {
  /** Água preenche o ar até esta altura (inclusive). Padrão 16. -1 desliga. */
  readonly seaLevel?: number;
  /** Cavernas por ruído 3D. Padrão false. */
  readonly caves?: boolean;
  /** Limiar do ruído de caverna (maior = menos cavernas). Padrão 0.42. */
  readonly caveThreshold?: number;
}

export interface TerrainMeshingOptions {
  /** Máximo de malhas montadas por update/frame. Padrão 2. */
  readonly maxMeshesPerUpdate?: number;
  /** Orçamento de tempo (ms) por update/frame para montagem (sempre monta ao menos 1). Padrão 4. */
  readonly budgetMs?: number;
}

export interface TerrainConfigOptions {
  readonly generation?: TerrainGenerationOptions;
  readonly streaming?: TerrainStreamingOptions;
  readonly colliders?: TerrainColliderOptions;
  readonly meshing?: TerrainMeshingOptions;
  /** Paleta parcial: id → definição (mesclada à atual). */
  readonly palette?: Readonly<Record<number, TerrainBlockDefinition>>;
  /** Tom por bioma (0xRRGGBB) para blocos `tintByBiome`. */
  readonly biomeTints?: Readonly<Record<string, number>>;
}

/** Edições persistentes (G56): sobrevivem a unload/reload e podem ser salvas. */
export interface TerrainEditsSnapshot {
  readonly version: 1;
  readonly seed: number;
  /** Cada chunk: coord + triplas planas [índiceLocal, blockId, metadata, ...]. */
  readonly chunks: ReadonlyArray<{
    readonly coord: Vector3Chunk;
    readonly edits: ReadonlyArray<number>;
  }>;
}

export interface TerrainStats {
  readonly loadedChunks: number;
  readonly renderedChunks: number;
  readonly pendingGenerations: number;
  readonly queuedMeshes: number;
  readonly colliders: number;
  readonly editedVoxels: number;
  readonly streamingEnabled: boolean;
}

export interface CompiledChunkMeshBuffers {
  readonly chunkCoord: Vector3Chunk;
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
  readonly transparentPositions?: Float32Array;
  readonly transparentNormals?: Float32Array;
  readonly transparentUvs?: Float32Array;
  readonly transparentIndices?: Uint32Array;
  /** RGB por vértice da malha opaca (quando há paleta). */
  readonly colors?: Float32Array;
  /** RGBA por vértice da malha transparente. */
  readonly transparentColors?: Float32Array;
  /** Malha de colisão (só blocos `solid`), coordenadas locais do chunk. */
  readonly collisionPositions?: Float32Array;
  readonly collisionIndices?: Uint32Array;
}

// ── EVENTOS DE TERRENO ──────────────────────────────────────────────────────

export interface ChunkGeneratedPayload {
  readonly chunkCoord: Vector3Chunk;
  readonly totalVertices: number;
  readonly generationTimeMs: number;
}

export const ChunkGeneratedEvent = defineEvent<
  "game.terrain.chunk-generated",
  ChunkGeneratedPayload
>("game.terrain.chunk-generated");

export interface BlockModifiedPayload {
  readonly worldPosition: Vector3Chunk;
  readonly oldBlockId: number;
  readonly newBlockId: number;
}

export const BlockModifiedEvent = defineEvent<
  "game.terrain.block-modified",
  BlockModifiedPayload
>("game.terrain.block-modified");

export interface ChunkUnloadedPayload {
  readonly chunkCoord: Vector3Chunk;
}

export const ChunkUnloadedEvent = defineEvent<
  "game.terrain.chunk-unloaded",
  ChunkUnloadedPayload
>("game.terrain.chunk-unloaded");

export interface TerrainResetPayload {
  readonly reason: "seed-changed" | "clear" | "edits-imported";
  readonly previousSeed: number;
  readonly seed: number;
  readonly unloadedChunks: number;
  readonly discardedEdits: number;
}

/** Emitido quando o mundo inteiro é descartado (G55: nunca mais em silêncio). */
export const TerrainResetEvent = defineEvent<
  "game.terrain.reset",
  TerrainResetPayload
>("game.terrain.reset");

// ── COMANDOS DE TERRENO ──────────────────────────────────────────────────────

export interface RequestChunkLoadPayload {
  readonly chunkCoord: Vector3Chunk;
  /**
   * Seed esperada. Se difere da atual e o mundo já tem chunks/edições, o
   * pedido é RECUSADO (log de aviso) em vez de apagar o mundo (G55).
   * Para trocar de mundo use `setSeed` (emite `game.terrain.reset`).
   */
  readonly seed?: number;
}

export const RequestChunkLoadCommand = defineCommand<
  "game.terrain.request-chunk",
  RequestChunkLoadPayload
>("game.terrain.request-chunk");

export interface ModifyVoxelBlockPayload {
  readonly request?: VoxelModificationRequest;
  /** Lote: uma remontagem por chunk afetado (G18). */
  readonly requests?: ReadonlyArray<VoxelModificationRequest>;
}

export const ModifyVoxelBlockCommand = defineCommand<
  "game.terrain.modify-block",
  ModifyVoxelBlockPayload
>("game.terrain.modify-block");