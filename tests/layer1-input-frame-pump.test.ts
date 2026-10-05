// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  InputFramePump,
} from "../src/engine/input/internal/InputFramePump";

import type {
  InputFrameScheduler,
} from "../src/engine/input/internal/InputFramePump";

describe(
  "Etapa 78 — InputFramePump",
  () => {
    it(
      "agenda exatamente um frame, atualiza e reagenda sem overlap",
      (): void => {
        let nextHandle =
          1;

        let updates =
          0;

        const callbacks =
          new Map<
            number,
            FrameRequestCallback
          >();

        const cancelled:
          number[] =
          [];

        const scheduler:
          InputFrameScheduler = {
            requestFrame(
              callback,
            ): number {
              const handle =
                nextHandle;

              nextHandle +=
                1;

              callbacks.set(
                handle,
                callback,
              );

              return handle;
            },

            cancelFrame(
              handle,
            ): void {
              cancelled.push(
                handle,
              );

              callbacks.delete(
                handle,
              );
            },
          };

        const pump =
          new InputFramePump(
            {
              update(): void {
                updates +=
                  1;
              },
            },
            scheduler,
          );

        expect(
          pump.start(),
        ).toBe(true);

        expect(
          pump.start(),
        ).toBe(false);

        expect(
          callbacks.size,
        ).toBe(1);

        const first =
          callbacks.get(
            1,
          );

        if (
          first ===
          undefined
        ) {
          throw new Error(
            "primeiro RAF ausente.",
          );
        }

        callbacks.delete(
          1,
        );

        first(
          16,
        );

        expect(
          updates,
        ).toBe(1);

        expect(
          callbacks.size,
        ).toBe(1);

        pump.stop();
        pump.stop();

        expect(
          cancelled,
        ).toEqual([
          2,
        ]);

        expect(
          pump.isRunning,
        ).toBe(false);

        pump.dispose();

        expect(
          pump.start(),
        ).toBe(false);
      },
    );
  },
);
