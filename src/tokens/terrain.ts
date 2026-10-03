import { defineCapability } from "../core/contracts/capability-token";
import type {
  Vector3Chunk,
  VoxelBlockData,
  BiomeDescriptor,
  VoxelModificationRequest,
} from "../contracts/terrain/types";

export interface TerrainApi {
  setSeed(seed: number): void;
  getSeed(): number;
  requestChunk(chunkCoord: Vector3Chunk): void;
  unloadChunk(chunkCoord: Vector3Chunk): boolean;
  getVoxelBlock(worldPos: Vector3Chunk): VoxelBlockData;
  modifyVoxelBlock(request: VoxelModificationRequest): boolean;
  getBiomeAt(worldPos: Vector3Chunk): BiomeDescriptor;
  getActiveChunkCount(): number;
  update(deltaSeconds: number, playerPosition?: Vector3Chunk): void;
  clear(): void;
}

export const TerrainToken = defineCapability<TerrainApi>("game.terrain", "1.0.0");