// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  ChunkDataMatrix,
} from "../src/contracts/terrain/types";

import {
  ProceduralWorkerPool,
} from "../src/engine/terrain/internal/ProceduralWorkerPool";

interface TerrainWorkerRequestForTest {
  readonly jobId:
    number;

  readonly coord: {
    readonly x:
      number;
    readonly y:
      number;
    readonly z:
      number;
  };

  readonly seed:
    number;
}

interface TerrainWorkerResponseForTest {
  readonly jobId:
    number;

  readonly chunk?:
    ChunkDataMatrix;

  readonly error?:
    string;
}

class FakeTerrainWorker {
  public terminated =
    false;

  public lastRequest:
    TerrainWorkerRequestForTest |
    null =
      null;

  private messageListener:
    (
      event:
        MessageEvent<
          TerrainWorkerResponseForTest
        >,
    ) => void =
      (): void => {};

  private errorListener:
    (
      event:
        ErrorEvent,
    ) => void =
      (): void => {};

  public addEventListener(
    type:
      string,
    listener:
      EventListenerOrEventListenerObject,
  ): void {
    if (
      typeof listener !==
      "function"
    ) {
      return;
    }

    if (
      type ===
      "message"
    ) {
      this.messageListener =
        listener as
          (
            event:
              MessageEvent<
                TerrainWorkerResponseForTest
              >,
          ) => void;
    } else if (
      type ===
      "error"
    ) {
      this.errorListener =
        listener as
          (
            event:
              ErrorEvent,
          ) => void;
    }
  }

  public postMessage(
    value:
      unknown,
  ): void {
    this.lastRequest =
      value as
        TerrainWorkerRequestForTest;
  }

  public terminate(): void {
    this.terminated =
      true;
  }

  public fail(): void {
    this.errorListener(
      {
        message:
          "worker failure",
      } as
        ErrorEvent,
    );
  }
}

describe(
  "Etapa 79 — ProceduralWorkerPool",
  () => {
    it(
      "erro de Worker cai para geração local e conclui job",
      async (): Promise<void> => {
        const worker =
          new FakeTerrainWorker();

        const pool =
          new ProceduralWorkerPool(
            1,
            (): Worker =>
              worker as unknown as
                Worker,
          );

        const promise =
          pool.requestChunkGenerationAsync(
            {
              x:
                0,
              y:
                0,
              z:
                0,
            },
            1337,
          );

        worker.fail();

        const chunk =
          await promise;

        expect(
          chunk.blocks.length,
        ).toBe(
          16 *
          128 *
          16,
        );

        expect(
          pool.pendingJobCount,
        ).toBe(0);

        expect(
          pool.activeWorkerCount,
        ).toBe(0);

        pool.clear();
      },
    );

    it(
      "clear rejeita jobs em voo e torna pool terminal",
      async (): Promise<void> => {
        const worker =
          new FakeTerrainWorker();

        const pool =
          new ProceduralWorkerPool(
            1,
            (): Worker =>
              worker as unknown as
                Worker,
          );

        const pending =
          pool.requestChunkGenerationAsync(
            {
              x:
                1,
              y:
                0,
              z:
                1,
            },
            77,
          );

        pool.clear();
        pool.clear();

        await expect(
          pending,
        ).rejects.toThrow(
          "encerrado",
        );

        expect(
          worker.terminated,
        ).toBe(true);

        await expect(
          pool.requestChunkGenerationAsync(
            {
              x:
                0,
              y:
                0,
              z:
                0,
            },
            1,
          ),
        ).rejects.toThrow(
          "encerrado",
        );
      },
    );
  },
);
