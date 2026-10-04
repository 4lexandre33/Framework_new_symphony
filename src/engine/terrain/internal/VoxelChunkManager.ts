import * as THREE from "three";

import type {
  BiomeDescriptor,
  ChunkDataMatrix,
  Vector3Chunk,
  VoxelBlockData,
  VoxelModificationRequest,
} from "../../../contracts/terrain/types";

import {
  BiomeEvaluator,
} from "./BiomeEvaluator";

import {
  GreedyMesher,
} from "./GreedyMesher";

import {
  PerlinNoiseService,
} from "./PerlinNoiseService";

interface VoxelAddress {
  readonly chunkCoord:
    Vector3Chunk;

  readonly localX:
    number;

  readonly localY:
    number;

  readonly localZ:
    number;
}

export class VoxelChunkManager {
  private seed =
    1337;

  private readonly sizeX =
    16;

  private readonly sizeY =
    128;

  private readonly sizeZ =
    16;

  private readonly loadedChunks =
    new Map<
      string,
      ChunkDataMatrix
    >();

  private readonly noiseService =
    new PerlinNoiseService(
      this.seed,
    );

  private readonly biomeEvaluator =
    new BiomeEvaluator(
      this.seed,
    );

  public setSeed(
    seed: number,
  ): void {
    const normalizedSeed =
      Number.isFinite(
        seed,
      )
        ? Math.trunc(
            seed,
          )
        : 1337;

    if (
      this.seed ===
      normalizedSeed
    ) {
      return;
    }

    /*
     * Chunks de seeds diferentes nunca devem
     * coexistir dentro do mesmo manager.
     */
    this.loadedChunks.clear();

    this.seed =
      normalizedSeed;

    this.noiseService.reseed(
      normalizedSeed,
    );

    this.biomeEvaluator.reseed(
      normalizedSeed,
    );
  }

  public getSeed():
    number {
    return this.seed;
  }

  public getChunkKey(
    coord:
      Vector3Chunk,
  ): string {
    return `${coord.x}:${coord.y}:${coord.z}`;
  }

  public getChunkCoordFromWorldPosition(
    worldPosition:
      Vector3Chunk,
  ): Vector3Chunk {
    const voxelX =
      Math.floor(
        worldPosition.x,
      );

    const voxelY =
      Math.floor(
        worldPosition.y,
      );

    const voxelZ =
      Math.floor(
        worldPosition.z,
      );

    return {
      x:
        Math.floor(
          voxelX /
          this.sizeX,
        ),

      y:
        Math.floor(
          voxelY /
          this.sizeY,
        ),

      z:
        Math.floor(
          voxelZ /
          this.sizeZ,
        ),
    };
  }

  public getChunkData(
    coord:
      Vector3Chunk,
  ): ChunkDataMatrix | null {
    return (
      this.loadedChunks.get(
        this.getChunkKey(
          coord,
        ),
      ) ??
      null
    );
  }

  public getChunkDataByWorldPosition(
    worldPosition:
      Vector3Chunk,
  ): ChunkDataMatrix | null {
    return this.getChunkData(
      this.getChunkCoordFromWorldPosition(
        worldPosition,
      ),
    );
  }

  public getBiomeAt(
    worldPosition:
      Vector3Chunk,
  ): BiomeDescriptor {
    return this.biomeEvaluator
      .evaluateBiome(
        worldPosition,
      );
  }

  public generateChunkData(
    coord:
      Vector3Chunk,
  ): ChunkDataMatrix {
    const totalBlocks =
      this.sizeX *
      this.sizeY *
      this.sizeZ;

    const blocks =
      new Uint8Array(
        totalBlocks,
      );

    const worldOffsetX =
      coord.x *
      this.sizeX;

    const worldOffsetY =
      coord.y *
      this.sizeY;

    const worldOffsetZ =
      coord.z *
      this.sizeZ;

    for (
      let localX = 0;
      localX <
      this.sizeX;
      localX += 1
    ) {
      for (
        let localZ = 0;
        localZ <
        this.sizeZ;
        localZ += 1
      ) {
        const worldX =
          worldOffsetX +
          localX;

        const worldZ =
          worldOffsetZ +
          localZ;

        const biome =
          this.biomeEvaluator
            .evaluateBiome({
              x:
                worldX,

              y:
                0,

              z:
                worldZ,
            });

        const rawHeightNoise =
          this.noiseService
            .fractalNoise2D(
              worldX *
                0.01,

              worldZ *
                0.01,

              4,
              0.5,
              2,
            );

        const normalizedHeightNoise =
          Math.min(
            1,
            Math.max(
              0,
              (
                rawHeightNoise +
                1
              ) *
                0.5,
            ),
          );

        const terrainHeight =
          Math.floor(
            biome.minHeight +
            normalizedHeightNoise *
              (
                biome.maxHeight -
                biome.minHeight
              ),
          );

        for (
          let localY = 0;
          localY <
          this.sizeY;
          localY += 1
        ) {
          const worldY =
            worldOffsetY +
            localY;

          const index =
            localX +
            this.sizeX *
              (
                localZ +
                this.sizeZ *
                  localY
              );

          if (
            worldY ===
            terrainHeight
          ) {
            blocks[index] =
              biome.surfaceBlockId;

            continue;
          }

          if (
            worldY <
              terrainHeight &&
            worldY >=
              terrainHeight -
                3
          ) {
            blocks[index] =
              biome.subSurfaceBlockId;

            continue;
          }

          if (
            worldY <
            terrainHeight -
              3
          ) {
            blocks[index] =
              2;

            continue;
          }

          blocks[index] =
            0;
        }
      }
    }

    const chunkData:
      ChunkDataMatrix = {
        coord: {
          x:
            coord.x,

          y:
            coord.y,

          z:
            coord.z,
        },

        sizeX:
          this.sizeX,

        sizeY:
          this.sizeY,

        sizeZ:
          this.sizeZ,

        blocks,
      };

    this.loadedChunks.set(
      this.getChunkKey(
        coord,
      ),
      chunkData,
    );

    return chunkData;
  }

  public buildChunkMesh(
    chunkData:
      ChunkDataMatrix,
  ): THREE.Mesh {
    const compiled =
      GreedyMesher
        .compileChunkMesh(
          chunkData,
        );

    const geometry =
      new THREE.BufferGeometry();

    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(
        compiled.positions,
        3,
      ),
    );

    geometry.setAttribute(
      "normal",
      new THREE.BufferAttribute(
        compiled.normals,
        3,
      ),
    );

    geometry.setAttribute(
      "uv",
      new THREE.BufferAttribute(
        compiled.uvs,
        2,
      ),
    );

    geometry.setIndex(
      new THREE.BufferAttribute(
        compiled.indices,
        1,
      ),
    );

    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const material =
      new THREE.MeshLambertMaterial({
        color:
          0x88cc44,

        side:
          THREE.FrontSide,
      });

    const mesh =
      new THREE.Mesh(
        geometry,
        material,
      );

    mesh.name =
      `terrain_chunk_${this.getChunkKey(
        chunkData.coord,
      )}`;

    mesh.position.set(
      chunkData.coord.x *
        this.sizeX,

      chunkData.coord.y *
        this.sizeY,

      chunkData.coord.z *
        this.sizeZ,
    );

    mesh.castShadow =
      true;

    mesh.receiveShadow =
      true;

    mesh.updateMatrix();

    mesh.matrixAutoUpdate =
      false;

    return mesh;
  }

  public unloadChunk(
    coord:
      Vector3Chunk,
  ): boolean {
    return this.loadedChunks
      .delete(
        this.getChunkKey(
          coord,
        ),
      );
  }

  public getVoxelBlock(
    worldPosition:
      Vector3Chunk,
  ): VoxelBlockData {
    const address =
      this.resolveVoxelAddress(
        worldPosition,
      );

    const chunk =
      this.loadedChunks.get(
        this.getChunkKey(
          address.chunkCoord,
        ),
      );

    if (!chunk) {
      return {
        id: 0,
      };
    }

    const index =
      address.localX +
      chunk.sizeX *
        (
          address.localZ +
          chunk.sizeZ *
            address.localY
        );

    return {
      id:
        chunk.blocks[
          index
        ] ??
        0,
    };
  }

  public modifyVoxelBlock(
    request:
      VoxelModificationRequest,
  ): boolean {
    if (
      !Number.isInteger(
        request.newBlockId,
      ) ||
      request.newBlockId <
        0 ||
      request.newBlockId >
        255
    ) {
      return false;
    }

    const address =
      this.resolveVoxelAddress(
        request.worldPosition,
      );

    const chunk =
      this.loadedChunks.get(
        this.getChunkKey(
          address.chunkCoord,
        ),
      );

    if (!chunk) {
      return false;
    }

    const index =
      address.localX +
      chunk.sizeX *
        (
          address.localZ +
          chunk.sizeZ *
            address.localY
        );

    chunk.blocks[
      index
    ] =
      request.newBlockId;

    return true;
  }

  public getActiveChunkCount():
    number {
    return this.loadedChunks
      .size;
  }

  public clear(): void {
    this.loadedChunks.clear();
  }

  private resolveVoxelAddress(
    worldPosition:
      Vector3Chunk,
  ): VoxelAddress {
    const voxelX =
      Math.floor(
        worldPosition.x,
      );

    const voxelY =
      Math.floor(
        worldPosition.y,
      );

    const voxelZ =
      Math.floor(
        worldPosition.z,
      );

    const chunkX =
      Math.floor(
        voxelX /
        this.sizeX,
      );

    const chunkY =
      Math.floor(
        voxelY /
        this.sizeY,
      );

    const chunkZ =
      Math.floor(
        voxelZ /
        this.sizeZ,
      );

    return {
      chunkCoord: {
        x:
          chunkX,

        y:
          chunkY,

        z:
          chunkZ,
      },

      localX:
        voxelX -
        chunkX *
          this.sizeX,

      localY:
        voxelY -
        chunkY *
          this.sizeY,

      localZ:
        voxelZ -
        chunkZ *
          this.sizeZ,
    };
  }
}