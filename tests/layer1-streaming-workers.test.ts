// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  StreamingJobRequest,
  StreamingJobResponse,
} from "../src/engine/streaming/internal/StreamingWorkerPool";

import {
  StreamingWorkerPool,
} from "../src/engine/streaming/internal/StreamingWorkerPool";

class FakeWorker {
  public terminated =
    false;

  public lastRequest:
    StreamingJobRequest |
    null =
      null;

  private messageListener:
    (
      event:
        MessageEvent<
          StreamingJobResponse
        >,
    ) => void =
      (): void => {};

  private errorListener:
    () => void =
      (): void => {};

  private messageErrorListener:
    () => void =
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
                StreamingJobResponse
              >,
          ) => void;
    } else if (
      type ===
      "error"
    ) {
      this.errorListener =
        listener as
          () => void;
    } else if (
      type ===
      "messageerror"
    ) {
      this.messageErrorListener =
        listener as
          () => void;
    }
  }

  public postMessage(
    value:
      unknown,
  ): void {
    this.lastRequest =
      value as
        StreamingJobRequest;
  }

  public terminate(): void {
    this.terminated =
      true;
  }

  public respond(
    visibleSectors:
      readonly {
        x:
          number;
        y:
          number;
        z:
          number;
      }[],
  ): void {
    const request =
      this.lastRequest;

    if (
      request ===
      null
    ) {
      throw new Error(
        "request ausente.",
      );
    }

    this.messageListener(
      {
        data: {
          jobId:
            request.jobId,
          visibleSectors,
        },
      } as
        MessageEvent<
          StreamingJobResponse
        >,
    );
  }

  public fail(): void {
    this.errorListener();
  }

  public failMessage(): void {
    this.messageErrorListener();
  }
}

describe(
  "Etapa 79 — StreamingWorkerPool",
  () => {
    it(
      "resolve job do Worker e libera slot",
      async (): Promise<void> => {
        const worker =
          new FakeWorker();

        const pool =
          new StreamingWorkerPool(
            1,
            (): Worker =>
              worker as unknown as
                Worker,
          );

        const promise =
          pool.processVisibilityAsync(
            {
              x:
                0,
              y:
                0,
              z:
                0,
            },
            [
              {
                x:
                  0,
                y:
                  0,
                z:
                  0,
              },
            ],
            100,
          );

        expect(
          pool.busyWorkerCount,
        ).toBe(1);

        worker.respond([
          {
            x:
              0,
            y:
              0,
            z:
              0,
          },
        ]);

        await expect(promise)
          .resolves.toEqual([
            {
              x:
                0,
              y:
                0,
              z:
                0,
            },
          ]);

        expect(
          pool.busyWorkerCount,
        ).toBe(0);

        expect(
          pool.pendingJobCount,
        ).toBe(0);

        pool.clear();
      },
    );

    it(
      "erro de Worker sempre resolve por fallback e não deixa Promise pendente",
      async (): Promise<void> => {
        const worker =
          new FakeWorker();

        const pool =
          new StreamingWorkerPool(
            1,
            (): Worker =>
              worker as unknown as
                Worker,
          );

        const promise =
          pool.processVisibilityAsync(
            {
              x:
                0,
              y:
                0,
              z:
                0,
            },
            [
              {
                x:
                  0,
                y:
                  0,
                z:
                  0,
              },
              {
                x:
                  10,
                y:
                  0,
                z:
                  10,
              },
            ],
            100,
          );

        worker.fail();

        await expect(promise)
          .resolves.toEqual([
            {
              x:
                0,
              y:
                0,
              z:
                0,
            },
          ]);

        expect(
          pool.pendingJobCount,
        ).toBe(0);

        pool.clear();
      },
    );

    it(
      "clear finaliza job pendente por fallback e termina Worker exatamente uma vez",
      async (): Promise<void> => {
        const worker =
          new FakeWorker();

        const pool =
          new StreamingWorkerPool(
            1,
            (): Worker =>
              worker as unknown as
                Worker,
          );

        const promise =
          pool.processVisibilityAsync(
            {
              x:
                0,
              y:
                0,
              z:
                0,
            },
            [
              {
                x:
                  0,
                y:
                  0,
                z:
                  0,
              },
            ],
            100,
          );

        pool.clear();
        pool.clear();

        await expect(promise)
          .resolves.toHaveLength(
            1,
          );

        expect(
          worker.terminated,
        ).toBe(true);

        expect(
          pool.workerCount,
        ).toBe(0);

        expect(
          pool.busyWorkerCount,
        ).toBe(0);
      },
    );
  },
);
