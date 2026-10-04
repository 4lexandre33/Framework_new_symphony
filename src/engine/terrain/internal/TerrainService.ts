import type { PluginContext } from "@core";
import { type TerrainApi } from "../../../tokens/terrain";
import { type Render3DApi } from "../../../tokens/render";
import { BlockModifiedEvent, ChunkGeneratedEvent, type BiomeDescriptor, type Vector3Chunk, type VoxelBlockData, type VoxelModificationRequest } from "../../../contracts/terrain/types";
import { VoxelChunkManager } from "./VoxelChunkManager";

export class TerrainService
  implements TerrainApi {
  private readonly chunkManager =
    new VoxelChunkManager();

  private readonly renderedChunkKeys =
    new Set<string>();

  private render:
    Render3DApi | null =
      null;

  public constructor(
    private readonly ctx:
      PluginContext,
  ) {}

  public bindDependencies(
    render:
      Render3DApi,
  ): void {
    this.render =
      render;
  }

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
      normalizedSeed ===
      this.chunkManager
        .getSeed()
    ) {
      return;
    }

    /*
     * Não permitimos chunks visuais produzidos
     * por seeds diferentes coexistirem.
     */
    this.clear();

    this.chunkManager.setSeed(
      normalizedSeed,
    );
  }

  public getSeed():
    number {
    return this.chunkManager
      .getSeed();
  }

  public requestChunk(
    chunkCoord:
      Vector3Chunk,
  ): void {
    const render =
      this.render;

    if (!render) {
      return;
    }

    const startedAt =
      performance.now();

    const chunkData =
      this.chunkManager
        .generateChunkData(
          chunkCoord,
        );

    const mesh =
      this.chunkManager
        .buildChunkMesh(
          chunkData,
        );

    const renderKey =
      this.getRenderKey(
        chunkCoord,
      );

    /*
     * SceneGraphManager remove e libera
     * automaticamente uma malha antiga caso
     * a chave já exista.
     */
    render.addMeshToScene(
      renderKey,
      mesh,
    );

    this.renderedChunkKeys.add(
      renderKey,
    );

    const positionAttribute =
      mesh.geometry
        .getAttribute(
          "position",
        );

    const generationTimeMs =
      performance.now() -
      startedAt;

    this.ctx.events.emit(
      ChunkGeneratedEvent.type,
      {
        chunkCoord: {
          x:
            chunkCoord.x,

          y:
            chunkCoord.y,

          z:
            chunkCoord.z,
        },

        totalVertices:
          positionAttribute.count,

        generationTimeMs,
      },
    );
  }

  public unloadChunk(
    chunkCoord:
      Vector3Chunk,
  ): boolean {
    const renderKey =
      this.getRenderKey(
        chunkCoord,
      );

    const render =
      this.render;

    if (render) {
      render.removeMeshFromScene(
        renderKey,
      );
    }

    this.renderedChunkKeys.delete(
      renderKey,
    );

    return this.chunkManager
      .unloadChunk(
        chunkCoord,
      );
  }

  public getVoxelBlock(
    worldPos:
      Vector3Chunk,
  ): VoxelBlockData {
    return this.chunkManager
      .getVoxelBlock(
        worldPos,
      );
  }

  public modifyVoxelBlock(
    request:
      VoxelModificationRequest,
  ): boolean {
    const previousBlock =
      this.getVoxelBlock(
        request.worldPosition,
      );

    const success =
      this.chunkManager
        .modifyVoxelBlock(
          request,
        );

    if (!success) {
      return false;
    }

    if (
      previousBlock.id !==
      request.newBlockId
    ) {
      this.rebuildChunkForWorldPosition(
        request.worldPosition,
      );

      this.ctx.events.emit(
        BlockModifiedEvent.type,
        {
          worldPosition: {
            x:
              request
                .worldPosition
                .x,

            y:
              request
                .worldPosition
                .y,

            z:
              request
                .worldPosition
                .z,
          },

          oldBlockId:
            previousBlock.id,

          newBlockId:
            request.newBlockId,
        },
      );
    }

    return true;
  }

  public getBiomeAt(
    worldPos:
      Vector3Chunk,
  ): BiomeDescriptor {
    return this.chunkManager
      .getBiomeAt(
        worldPos,
      );
  }

  public getActiveChunkCount():
    number {
    return this.chunkManager
      .getActiveChunkCount();
  }

  public update(
    _deltaSeconds:
      number,
    _playerPosition?:
      Vector3Chunk,
  ): void {
    /*
     * Ponto de integração para streaming de chunks.
     *
     * O tick já possui owner único no game.loop.
     * O streaming por posição pode ser ligado aqui
     * quando o PlayerToken expuser a posição global.
     */
  }

  public clear(): void {
    const render =
      this.render;

    if (render) {
      for (
        const renderKey of
        this.renderedChunkKeys
      ) {
        render
          .removeMeshFromScene(
            renderKey,
          );
      }
    }

    this.renderedChunkKeys.clear();

    this.chunkManager.clear();
  }

  private rebuildChunkForWorldPosition(
    worldPosition:
      Vector3Chunk,
  ): void {
    const render =
      this.render;

    if (!render) {
      return;
    }

    const chunkData =
      this.chunkManager
        .getChunkDataByWorldPosition(
          worldPosition,
        );

    if (!chunkData) {
      return;
    }

    const mesh =
      this.chunkManager
        .buildChunkMesh(
          chunkData,
        );

    const renderKey =
      this.getRenderKey(
        chunkData.coord,
      );

    render.addMeshToScene(
      renderKey,
      mesh,
    );

    this.renderedChunkKeys.add(
      renderKey,
    );
  }

  private getRenderKey(
    chunkCoord:
      Vector3Chunk,
  ): string {
    return (
      "chunk_" +
      this.chunkManager
        .getChunkKey(
          chunkCoord,
        )
    );
  }
}
