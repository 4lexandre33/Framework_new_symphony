import * as THREE from "three";

import type {
  BiomeDescriptor,
  ChunkDataMatrix,
  CompiledChunkMeshBuffers,
  Vector3Chunk,
  VoxelBlockData,
  VoxelModificationRequest,
} from "../../../contracts/terrain/types";

import {
  GreedyMesher,
  type GreedyMeshOptions,
} from "./GreedyMesher";

import {
  CHUNK_SIZE_X,
  CHUNK_SIZE_Y,
  CHUNK_SIZE_Z,
  DEFAULT_GENERATION_CONFIG,
  TerrainGenerator,
  normalizeTerrainSeed,
  type ResolvedGenerationConfig,
} from "./TerrainGenerator";

export interface VoxelAddress {
  chunkX: number;
  chunkY: number;
  chunkZ: number;
  localX: number;
  localY: number;
  localZ: number;
  /** Índice local = x + sizeX * (z + sizeZ * y). */
  index: number;
}

export function createVoxelAddress(): VoxelAddress {
  return { chunkX: 0, chunkY: 0, chunkZ: 0, localX: 0, localY: 0, localZ: 0, index: 0 };
}

/** Materiais compartilhados entre chunks (retidos pelo render, liberados no dispose do terreno). */
export interface TerrainMaterials {
  readonly opaque: THREE.Material;
  readonly transparent: THREE.Material;
}

export class VoxelChunkManager {
  private seed = 1337;
  private readonly sizeX = CHUNK_SIZE_X;
  private readonly sizeY = CHUNK_SIZE_Y;
  private readonly sizeZ = CHUNK_SIZE_Z;
  private readonly loadedChunks = new Map<string, ChunkDataMatrix>();
  /** Metadata por voxel, alocada só para chunks que a usam. */
  private readonly metadata = new Map<string, Uint8Array>();
  private readonly generator: TerrainGenerator;
  private readonly scratchAddress = createVoxelAddress();

  public constructor(config: ResolvedGenerationConfig = DEFAULT_GENERATION_CONFIG) {
    this.generator = new TerrainGenerator(this.seed, config);
  }

  public getGenerator(): TerrainGenerator {
    return this.generator;
  }

  public getSizes(): { readonly sizeX: number; readonly sizeY: number; readonly sizeZ: number } {
    return { sizeX: this.sizeX, sizeY: this.sizeY, sizeZ: this.sizeZ };
  }

  public setSeed(seed: number): void {
    const normalizedSeed = normalizeTerrainSeed(seed);

    if (this.seed === normalizedSeed) {
      return;
    }

    // Chunks de seeds diferentes nunca devem coexistir dentro do mesmo manager.
    this.loadedChunks.clear();
    this.metadata.clear();
    this.seed = normalizedSeed;
    this.generator.reseed(normalizedSeed);
  }

  public getSeed(): number {
    return this.seed;
  }

  public getChunkKey(coord: Vector3Chunk): string {
    return `${coord.x}:${coord.y}:${coord.z}`;
  }

  public getChunkKeyXYZ(x: number, y: number, z: number): string {
    return `${x}:${y}:${z}`;
  }

  public getChunkCoordFromWorldPosition(worldPosition: Vector3Chunk): Vector3Chunk {
    this.resolveAddress(worldPosition.x, worldPosition.y, worldPosition.z, this.scratchAddress);
    return {
      x: this.scratchAddress.chunkX,
      y: this.scratchAddress.chunkY,
      z: this.scratchAddress.chunkZ,
    };
  }

  public getChunkData(coord: Vector3Chunk): ChunkDataMatrix | null {
    return this.loadedChunks.get(this.getChunkKey(coord)) ?? null;
  }

  public getChunkDataByKey(key: string): ChunkDataMatrix | null {
    return this.loadedChunks.get(key) ?? null;
  }

  public getChunkDataByWorldPosition(worldPosition: Vector3Chunk): ChunkDataMatrix | null {
    return this.getChunkData(this.getChunkCoordFromWorldPosition(worldPosition));
  }

  public getMetadataArray(key: string, create: boolean): Uint8Array | null {
    let array = this.metadata.get(key) ?? null;

    if (array === null && create) {
      array = new Uint8Array(this.sizeX * this.sizeY * this.sizeZ);
      this.metadata.set(key, array);
    }

    return array;
  }

  public getBiomeAt(worldPosition: Vector3Chunk): BiomeDescriptor {
    return this.generator.getBiomeAt(worldPosition.x, worldPosition.z);
  }

  /** Gera de forma síncrona e instala (fallback/headless/testes). */
  public generateChunkData(coord: Vector3Chunk): ChunkDataMatrix {
    const chunkData = this.generator.generateChunk(coord);
    this.loadedChunks.set(this.getChunkKey(coord), chunkData);
    return chunkData;
  }

  public installChunkData(chunkData: ChunkDataMatrix): void {
    if (
      !Number.isInteger(chunkData.sizeX) ||
      !Number.isInteger(chunkData.sizeY) ||
      !Number.isInteger(chunkData.sizeZ) ||
      chunkData.sizeX !== this.sizeX ||
      chunkData.sizeY !== this.sizeY ||
      chunkData.sizeZ !== this.sizeZ
    ) {
      throw new RangeError("ChunkDataMatrix possui dimensões incompatíveis com VoxelChunkManager.");
    }

    if (chunkData.blocks.length !== this.sizeX * this.sizeY * this.sizeZ) {
      throw new RangeError("ChunkDataMatrix possui quantidade de blocos inválida.");
    }

    this.loadedChunks.set(this.getChunkKey(chunkData.coord), chunkData);
  }

  public compileChunkMesh(chunkData: ChunkDataMatrix, options?: GreedyMeshOptions): CompiledChunkMeshBuffers {
    return GreedyMesher.compileChunkMesh(chunkData, options);
  }

  /**
   * Monta o objeto 3D do chunk: grupo com malha opaca (cores por vértice) e,
   * se houver, malha transparente (água/vidro). Sem `materials` usa material
   * próprio (legado).
   */
  public buildChunkObject(
    chunkData: ChunkDataMatrix,
    compiled: CompiledChunkMeshBuffers,
    materials?: TerrainMaterials,
  ): THREE.Object3D {
    const group = new THREE.Group();
    group.name = `terrain_chunk_${this.getChunkKey(chunkData.coord)}`;
    group.position.set(
      chunkData.coord.x * this.sizeX,
      chunkData.coord.y * this.sizeY,
      chunkData.coord.z * this.sizeZ,
    );

    if (compiled.positions.length > 0) {
      const geometry = this.createGeometry(
        compiled.positions,
        compiled.normals,
        compiled.uvs,
        compiled.indices,
        compiled.colors,
        3,
      );
      const material =
        materials?.opaque ??
        new THREE.MeshLambertMaterial({
          color: 0x88cc44,
          side: THREE.FrontSide,
        });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `${group.name}_opaque`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);
    }

    if (
      compiled.transparentPositions &&
      compiled.transparentNormals &&
      compiled.transparentUvs &&
      compiled.transparentIndices &&
      compiled.transparentPositions.length > 0 &&
      materials
    ) {
      const geometry = this.createGeometry(
        compiled.transparentPositions,
        compiled.transparentNormals,
        compiled.transparentUvs,
        compiled.transparentIndices,
        compiled.transparentColors,
        4,
      );
      const mesh = new THREE.Mesh(geometry, materials.transparent);
      mesh.name = `${group.name}_transparent`;
      mesh.renderOrder = 1;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);
    }

    group.updateMatrix();
    group.matrixAutoUpdate = false;
    return group;
  }

  /** Legado: malha única do chunk (material próprio). */
  public buildChunkMesh(chunkData: ChunkDataMatrix): THREE.Mesh {
    const compiled = GreedyMesher.compileChunkMesh(chunkData);
    const geometry = this.createGeometry(compiled.positions, compiled.normals, compiled.uvs, compiled.indices, undefined, 3);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color: 0x88cc44, side: THREE.FrontSide }));
    mesh.name = `terrain_chunk_${this.getChunkKey(chunkData.coord)}`;
    mesh.position.set(chunkData.coord.x * this.sizeX, chunkData.coord.y * this.sizeY, chunkData.coord.z * this.sizeZ);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    return mesh;
  }

  public unloadChunk(coord: Vector3Chunk): boolean {
    const key = this.getChunkKey(coord);
    this.metadata.delete(key);
    return this.loadedChunks.delete(key);
  }

  public getVoxelBlock(worldPosition: Vector3Chunk): VoxelBlockData {
    const address = this.resolveAddress(worldPosition.x, worldPosition.y, worldPosition.z, this.scratchAddress);
    const key = this.getChunkKeyXYZ(address.chunkX, address.chunkY, address.chunkZ);
    const chunk = this.loadedChunks.get(key);

    if (!chunk) {
      return { id: 0 };
    }

    const id = chunk.blocks[address.index] ?? 0;
    const metadata = this.metadata.get(key)?.[address.index] ?? 0;
    return metadata !== 0 ? { id, metadata } : { id };
  }

  public modifyVoxelBlock(request: VoxelModificationRequest): boolean {
    return this.setVoxel(request, this.scratchAddress) !== -1;
  }

  /**
   * Escreve o voxel. Retorna o id anterior, ou -1 se inválido/chunk ausente.
   * `address` recebe o endereço resolvido.
   */
  public setVoxel(request: VoxelModificationRequest, address: VoxelAddress): number {
    const newBlockId = request.newBlockId;
    const newMetadata = request.newMetadata ?? 0;

    if (
      !Number.isInteger(newBlockId) || newBlockId < 0 || newBlockId > 255 ||
      !Number.isInteger(newMetadata) || newMetadata < 0 || newMetadata > 255
    ) {
      return -1;
    }

    const position = request.worldPosition;

    if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)) {
      return -1;
    }

    this.resolveAddress(position.x, position.y, position.z, address);
    const key = this.getChunkKeyXYZ(address.chunkX, address.chunkY, address.chunkZ);
    const chunk = this.loadedChunks.get(key);

    if (!chunk) {
      return -1;
    }

    const previous = chunk.blocks[address.index] ?? 0;
    chunk.blocks[address.index] = newBlockId;
    const metadataArray = this.getMetadataArray(key, newMetadata !== 0);

    if (metadataArray) {
      metadataArray[address.index] = newMetadata;
    }

    return previous;
  }

  public getActiveChunkCount(): number {
    return this.loadedChunks.size;
  }

  public getLoadedKeys(): IterableIterator<string> {
    return this.loadedChunks.keys();
  }

  public clear(): void {
    this.loadedChunks.clear();
    this.metadata.clear();
  }

  public resolveAddress(worldX: number, worldY: number, worldZ: number, out: VoxelAddress): VoxelAddress {
    const voxelX = Math.floor(worldX);
    const voxelY = Math.floor(worldY);
    const voxelZ = Math.floor(worldZ);
    const chunkX = Math.floor(voxelX / this.sizeX);
    const chunkY = Math.floor(voxelY / this.sizeY);
    const chunkZ = Math.floor(voxelZ / this.sizeZ);
    out.chunkX = chunkX;
    out.chunkY = chunkY;
    out.chunkZ = chunkZ;
    out.localX = voxelX - chunkX * this.sizeX;
    out.localY = voxelY - chunkY * this.sizeY;
    out.localZ = voxelZ - chunkZ * this.sizeZ;
    out.index = out.localX + this.sizeX * (out.localZ + this.sizeZ * out.localY);
    return out;
  }

  private createGeometry(
    positions: Float32Array,
    normals: Float32Array,
    uvs: Float32Array,
    indices: Uint32Array,
    colors: Float32Array | undefined,
    colorSize: 3 | 4,
  ): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));

    if (colors && colors.length > 0) {
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, colorSize));
    }

    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }
}
