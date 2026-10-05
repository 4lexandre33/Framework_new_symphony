// @vitest-environment node

import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  Kernel,
} from "@core";

import {
  createGameLoopPlugin,
} from "../src/plugins/game-loop/plugin";

const originalRequestAnimationFrame =
  globalThis.requestAnimationFrame;
const originalCancelAnimationFrame =
  globalThis.cancelAnimationFrame;

function restoreGlobals(): void {
  if (
    originalRequestAnimationFrame ===
    undefined
  ) {
    delete (
      globalThis as
        Partial<typeof globalThis>
    ).requestAnimationFrame;
  } else {
    globalThis.requestAnimationFrame =
      originalRequestAnimationFrame;
  }

  if (
    originalCancelAnimationFrame ===
    undefined
  ) {
    delete (
      globalThis as
        Partial<typeof globalThis>
    ).cancelAnimationFrame;
  } else {
    globalThis.cancelAnimationFrame =
      originalCancelAnimationFrame;
  }
}

afterEach(
  (): void => {
    restoreGlobals();
  },
);

describe(
  "Etapa 75 — game.loop plugin integration",
  () => {
    it(
      "inicia somente após kernel.booted e cancela RAF no dispose",
      async () => {
        let nextFrameId =
          1;
        const scheduled =
          new Map<
            number,
            FrameRequestCallback
          >();
        const cancelled:
          number[] =
          [];

        globalThis.requestAnimationFrame =
          (
            callback:
              FrameRequestCallback,
          ): number => {
            const id =
              nextFrameId++;
            scheduled.set(
              id,
              callback,
            );
            return id;
          };

        globalThis.cancelAnimationFrame =
          (
            id: number,
          ): void => {
            cancelled.push(id);
            scheduled.delete(id);
          };

        const kernel =
          new Kernel();

        kernel.register(
          createGameLoopPlugin(),
        );

        expect(scheduled.size)
          .toBe(0);

        await kernel.boot();

        expect(kernel.status)
          .toBe("running");
        expect(scheduled.size)
          .toBe(1);

        const scheduledId =
          [...scheduled.keys()][0];

        expect(scheduledId)
          .toBeDefined();

        await kernel.stop();

        expect(scheduled.size)
          .toBe(0);
        expect(cancelled)
          .toContain(scheduledId);
      },
    );
  },
);
