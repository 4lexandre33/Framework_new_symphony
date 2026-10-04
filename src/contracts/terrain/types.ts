import { defineEvent, defineCommand } from "@core";

export interface Vector3Chunk {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface VoxelBlockData {
  readonly id: number; // 0 = Ar, 1 = Terra, 2 = Pedra, 3 = Grama, 4 = Areia, 5 = Neve, 6 = Madeira
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
  readonly sizeX: number; // Ex: 16
  readonly sizeY: number; // Ex: 256
  readonly sizeZ: number; // Ex: 16
  readonly blocks: Uint8Array;
}

export interface VoxelModificationRequest {
  readonly worldPosition: Vector3Chunk;
  readonly newBlockId: number;
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

// ── COMANDOS DE TERRENO ──────────────────────────────────────────────────────

export interface RequestChunkLoadPayload {
  readonly chunkCoord: Vector3Chunk;
  readonly seed: number;
}

export const RequestChunkLoadCommand = defineCommand<
  "game.terrain.request-chunk",
  RequestChunkLoadPayload
>("game.terrain.request-chunk");

export interface ModifyVoxelBlockPayload {
  readonly request: VoxelModificationRequest;
}

export const ModifyVoxelBlockCommand = defineCommand<
  "game.terrain.modify-block",
  ModifyVoxelBlockPayload
>("game.terrain.modify-block");