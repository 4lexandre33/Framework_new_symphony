import type {
  PluginContext,
} from "@core";

import type {
  BiomeDescriptor,
  ChunkDataMatrix,
  Vector3Chunk,
  VoxelBlockData,
  VoxelModificationRequest,
} from "../../../contracts/terrain/types";

import {
  BlockModifiedEvent,
  ChunkGeneratedEvent,
} from "../../../contracts/terrain/types";

import type {
  Render3DApi,
} from "../../../tokens/render";

import type {
  TerrainApi,
} from "../../../tokens/terrain";

import {
  ProceduralWorkerPool,
} from "./ProceduralWorkerPool";

import type {
  TerrainChunkWorkerPool,
} from "./ProceduralWorkerPool";

import {
  VoxelChunkManager,
} from "./VoxelChunkManager";

function nowMilliseconds():
  number {
  return typeof performance !==
    "undefined"
    ? performance.now()
    : Date.now();
}

function normalizeChunkCoord(
  coord:
    Vector3Chunk,
): Vector3Chunk {
  return {
    x:
      Number.isFinite(
        coord.x,
      )
        ? Math.trunc(
            coord.x,
          )
        : 0,

    y:
      Number.isFinite(
        coord.y,
      )
        ? Math.trunc(
            coord.y,
          )
        : 0,

    z:
      Number.isFinite(
        coord.z,
      )
        ? Math.trunc(
            coord.z,
          )
        : 0,
  };
}

export class TerrainService
  implements TerrainApi {
  private readonly renderedChunkKeys =
    new Set<
      string
    >();

  private readonly pendingChunkTokens =
    new Map<
      string,
      number
    >();

  private render:
    Render3DApi |
    null =
      null;

  private generationEpoch =
    1;

  private nextRequestToken =
    1;

  private disposed =
    false;

  public constructor(
    private readonly ctx:
      PluginContext,
    private readonly chunkManager:
      VoxelChunkManager =
        new VoxelChunkManager(),
    private readonly workerPool:
      TerrainChunkWorkerPool =
        new ProceduralWorkerPool(),
  ) {}

  public bindDependencies(
    render:
      Render3DApi,
  ): void {
    if (
      this.disposed
    ) {
      return;
    }

    this.render =
      render;
  }

  public setSeed(
    seed:
      number,
  ): void {
    if (
      this.disposed
    ) {
      return;
    }

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

    this.clear();

    this.chunkManager
      .setSeed(
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
    if (
      this.disposed ||
      this.render ===
        null
    ) {
      return;
    }

    const coord =
      normalizeChunkCoord(
        chunkCoord,
      );

    const renderKey =
      this.getRenderKey(
        coord,
      );

    const existing =
      this.chunkManager
        .getChunkData(
          coord,
        );

    if (
      existing !==
      null
    ) {
      this.renderChunk(
        existing,
        renderKey,
        0,
      );

      return;
    }

    if (
      this.pendingChunkTokens.has(
        renderKey,
      )
    ) {
      return;
    }

    const requestToken =
      this.allocateRequestToken();

    const requestEpoch =
      this.generationEpoch;

    const seed =
      this.getSeed();

    const startedAt =
      nowMilliseconds();

    this.pendingChunkTokens.set(
      renderKey,
      requestToken,
    );

    void this.workerPool
      .requestChunkGenerationAsync(
        coord,
        seed,
      )
      .then(
        (
          chunkData,
        ): void => {
          if (
            !this.isRequestCurrent(
              renderKey,
              requestToken,
              requestEpoch,
            ) ||
            this.disposed
          ) {
            return;
          }

          this.chunkManager
            .installChunkData(
              chunkData,
            );

          const generationTimeMs =
            Math.max(
              0,
              nowMilliseconds() -
                startedAt,
            );

          this.renderChunk(
            chunkData,
            renderKey,
            generationTimeMs,
          );
        },
      )
      .catch(
        (): void => {
          // Pool encerrado durante teardown/clear: request é descartada.
        },
      )
      .finally(
        (): void => {
          if (
            this.pendingChunkTokens.get(
              renderKey,
            ) ===
            requestToken
          ) {
            this.pendingChunkTokens.delete(
              renderKey,
            );
          }
        },
      );
  }

  public unloadChunk(
    chunkCoord:
      Vector3Chunk,
  ): boolean {
    const coord =
      normalizeChunkCoord(
        chunkCoord,
      );

    const renderKey =
      this.getRenderKey(
        coord,
      );

    this.invalidatePendingRequest(
      renderKey,
    );

    const render =
      this.render;

    if (
      render !==
      null
    ) {
      render.removeMeshFromScene(
        renderKey,
      );
    }

    this.renderedChunkKeys.delete(
      renderKey,
    );

    return this.chunkManager
      .unloadChunk(
        coord,
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
    if (
      this.disposed
    ) {
      return false;
    }

    const previousBlock =
      this.getVoxelBlock(
        request.worldPosition,
      );

    const success =
      this.chunkManager
        .modifyVoxelBlock(
          request,
        );

    if (
      !success
    ) {
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
    // O streaming espacial de chunks será composto em uma etapa superior.
  }

  public clear(): void {
    this.generationEpoch +=
      1;

    this.pendingChunkTokens.clear();

    const render =
      this.render;

    if (
      render !==
      null
    ) {
      for (
        const renderKey of
        this.renderedChunkKeys
      ) {
        render.removeMeshFromScene(
          renderKey,
        );
      }
    }

    this.renderedChunkKeys.clear();

    this.chunkManager.clear();
  }

  public dispose(): void {
    if (
      this.disposed
    ) {
      return;
    }

    this.clear();

    this.disposed =
      true;

    this.workerPool.clear();

    this.render =
      null;
  }

  private renderChunk(
    chunkData:
      ChunkDataMatrix,
    renderKey:
      string,
    generationTimeMs:
      number,
  ): void {
    const render =
      this.render;

    if (
      render ===
        null ||
      this.disposed
    ) {
      return;
    }

    const mesh =
      this.chunkManager
        .buildChunkMesh(
          chunkData,
        );

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

    this.ctx.events.emit(
      ChunkGeneratedEvent.type,
      {
        chunkCoord: {
          x:
            chunkData.coord.x,
          y:
            chunkData.coord.y,
          z:
            chunkData.coord.z,
        },
        totalVertices:
          positionAttribute.count,
        generationTimeMs,
      },
    );
  }

  private rebuildChunkForWorldPosition(
    worldPosition:
      Vector3Chunk,
  ): void {
    const render =
      this.render;

    if (
      render ===
        null ||
      this.disposed
    ) {
      return;
    }

    const chunkData =
      this.chunkManager
        .getChunkDataByWorldPosition(
          worldPosition,
        );

    if (
      chunkData ===
      null
    ) {
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

  private allocateRequestToken():
    number {
    const token =
      this.nextRequestToken;

    this.nextRequestToken +=
      1;

    if (
      this.nextRequestToken >=
      Number.MAX_SAFE_INTEGER
    ) {
      this.nextRequestToken =
        1;
    }

    return token;
  }

  private isRequestCurrent(
    renderKey:
      string,
    requestToken:
      number,
    requestEpoch:
      number,
  ): boolean {
    return (
      requestEpoch ===
        this.generationEpoch &&
      this.pendingChunkTokens.get(
        renderKey,
      ) ===
        requestToken
    );
  }

  private invalidatePendingRequest(
    renderKey:
      string,
  ): void {
    this.pendingChunkTokens.delete(
      renderKey,
    );
  }
}
