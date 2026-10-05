// @vitest-environment node

import type {
  PluginContext,
} from "@core";

import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  ChunkDataMatrix,
  Vector3Chunk,
} from "../src/contracts/terrain/types";

import type {
  TerrainChunkWorkerPool,
} from "../src/engine/terrain/internal/ProceduralWorkerPool";

import {
  TerrainService,
} from "../src/engine/terrain/internal/TerrainService";

import type {
  Render3DApi,
} from "../src/tokens/render";

function createChunk(
  coord:
    Vector3Chunk,
): ChunkDataMatrix {
  return {
    coord: {
      x:
        coord.x,
      y:
        coord.y,
      z:
        coord.z,
    },
    sizeX:
      16,
    sizeY:
      128,
    sizeZ:
      16,
    blocks:
      new Uint8Array(
        16 *
        128 *
        16,
      ),
  };
}

class ControlledTerrainPool
  implements TerrainChunkWorkerPool {
  public clearCalls =
    0;

  private resolveCurrent:
    (
      chunk:
        ChunkDataMatrix,
    ) => void =
      (): void => {};

  public requestChunkGenerationAsync(
    coord:
      Vector3Chunk,
    _seed:
      number,
  ): Promise<
    ChunkDataMatrix
  > {
    return new Promise<
      ChunkDataMatrix
    >(
      (
        resolve,
      ): void => {
        this.resolveCurrent =
          resolve;
      },
    );
  }

  public resolve(
    coord:
      Vector3Chunk,
  ): void {
    this.resolveCurrent(
      createChunk(
        coord,
      ),
    );
  }

  public clear(): void {
    this.clearCalls +=
      1;
  }
}

describe(
  "Etapa 79 — TerrainService worker integration",
  () => {
    it(
      "ignora resposta obsoleta após unload e não renderiza chunk cancelado",
      async (): Promise<void> => {
        const workerPool =
          new ControlledTerrainPool();

        const added:
          string[] =
          [];

        const events:
          string[] =
          [];

        const render = {
          addMeshToScene(
            key:
              string,
          ): void {
            added.push(
              key,
            );
          },

          removeMeshFromScene():
            void {},
        } as unknown as
          Render3DApi;

        const ctx = {
          events: {
            emit(
              type:
                string,
            ): void {
              events.push(
                type,
              );
            },
          },
        } as unknown as
          PluginContext;

        const service =
          new TerrainService(
            ctx,
            undefined,
            workerPool,
          );

        service.bindDependencies(
          render,
        );

        const coord = {
          x:
            2,
          y:
            0,
          z:
            3,
        };

        service.requestChunk(
          coord,
        );

        service.unloadChunk(
          coord,
        );

        workerPool.resolve(
          coord,
        );

        await Promise.resolve();
        await Promise.resolve();

        expect(added)
          .toEqual([]);

        expect(events)
          .not.toContain(
            "game.terrain.chunk-generated",
          );

        service.dispose();

        expect(
          workerPool.clearCalls,
        ).toBe(1);
      },
    );

    it(
      "clear invalida geração antiga por epoch",
      async (): Promise<void> => {
        const workerPool =
          new ControlledTerrainPool();

        const added:
          string[] =
          [];

        const render = {
          addMeshToScene(
            key:
              string,
          ): void {
            added.push(
              key,
            );
          },

          removeMeshFromScene():
            void {},
        } as unknown as
          Render3DApi;

        const ctx = {
          events: {
            emit(): void {},
          },
        } as unknown as
          PluginContext;

        const service =
          new TerrainService(
            ctx,
            undefined,
            workerPool,
          );

        service.bindDependencies(
          render,
        );

        const coord = {
          x:
            0,
          y:
            0,
          z:
            0,
        };

        service.requestChunk(
          coord,
        );

        service.clear();

        workerPool.resolve(
          coord,
        );

        await Promise.resolve();
        await Promise.resolve();

        expect(added)
          .toEqual([]);

        service.dispose();
      },
    );
  },
);
