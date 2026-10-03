import type {
  ChunkDataMatrix,
  Vector3Chunk,
} from "../../contracts/terrain/types";

import {
  BiomeEvaluator,
} from "./BiomeEvaluator";

import {
  PerlinNoiseService,
} from "./PerlinNoiseService";

interface TerrainWorkerRequest {
  readonly jobId:
    number;

  readonly coord:
    Vector3Chunk;

  readonly seed:
    number;
}

interface TerrainWorkerResponse {
  readonly jobId:
    number;

  readonly chunk?:
    ChunkDataMatrix;

  readonly error?:
    string;
}

interface TerrainWorkerScope {
  onmessage:
    (
      (
        event:
          MessageEvent<TerrainWorkerRequest>,
      ) => void
    ) |
    null;

  postMessage(
    message:
      TerrainWorkerResponse,
    transfer:
      Transferable[],
  ): void;
}

const workerScope =
  self as unknown as
    TerrainWorkerScope;

workerScope.onmessage =
  (
    event:
      MessageEvent<TerrainWorkerRequest>,
  ): void => {
    const {
      jobId,
      coord,
      seed,
    } =
      event.data;

    try {
      const chunk =
        generateChunk(
          coord,
          seed,
        );

      const transferBuffer =
        chunk.blocks
          .buffer as
          ArrayBuffer;

      workerScope.postMessage(
        {
          jobId,
          chunk,
        },
        [
          transferBuffer,
        ],
      );
    } catch (
      error: unknown
    ) {
      const message =
        error instanceof
        Error
          ? `${error.name}: ${error.message}`
          : String(
              error,
            );

      workerScope.postMessage(
        {
          jobId,
          error:
            message,
        },
        [],
      );
    }
  };

function generateChunk(
  coord:
    Vector3Chunk,
  seed:
    number,
): ChunkDataMatrix {
  const sizeX =
    16;

  const sizeY =
    128;

  const sizeZ =
    16;

  const blocks =
    new Uint8Array(
      sizeX *
      sizeY *
      sizeZ,
    );

  const noise =
    new PerlinNoiseService(
      seed,
    );

  const biomeEvaluator =
    new BiomeEvaluator(
      seed,
    );

  const worldOffsetX =
    coord.x *
    sizeX;

  const worldOffsetY =
    coord.y *
    sizeY;

  const worldOffsetZ =
    coord.z *
    sizeZ;

  for (
    let localX = 0;
    localX <
    sizeX;
    localX += 1
  ) {
    for (
      let localZ = 0;
      localZ <
      sizeZ;
      localZ += 1
    ) {
      const worldX =
        worldOffsetX +
        localX;

      const worldZ =
        worldOffsetZ +
        localZ;

      const biome =
        biomeEvaluator
          .evaluateBiome({
            x:
              worldX,

            y:
              0,

            z:
              worldZ,
          });

      const normalizedNoise =
        Math.min(
          1,
          Math.max(
            0,
            (
              noise
                .fractalNoise2D(
                  worldX *
                    0.01,

                  worldZ *
                    0.01,

                  4,
                  0.5,
                  2,
                ) +
              1
            ) *
              0.5,
          ),
        );

      const terrainHeight =
        Math.floor(
          biome.minHeight +
          normalizedNoise *
            (
              biome.maxHeight -
              biome.minHeight
            ),
        );

      for (
        let localY = 0;
        localY <
        sizeY;
        localY += 1
      ) {
        const worldY =
          worldOffsetY +
          localY;

        const blockIndex =
          localX +
          sizeX *
            (
              localZ +
              sizeZ *
                localY
            );

        if (
          worldY ===
          terrainHeight
        ) {
          blocks[
            blockIndex
          ] =
            biome.surfaceBlockId;
        } else if (
          worldY <
            terrainHeight &&
          worldY >=
            terrainHeight -
              3
        ) {
          blocks[
            blockIndex
          ] =
            biome.subSurfaceBlockId;
        } else if (
          worldY <
          terrainHeight -
            3
        ) {
          blocks[
            blockIndex
          ] =
            2;
        }
      }
    }
  }

  return {
    coord: {
      x:
        coord.x,

      y:
        coord.y,

      z:
        coord.z,
    },

    sizeX,
    sizeY,
    sizeZ,
    blocks,
  };
}