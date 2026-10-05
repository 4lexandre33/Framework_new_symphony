// @vitest-environment jsdom

import type {
  Plugin,
  PluginContext,
} from "@core";

import {
  Kernel,
} from "@core";

import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  InputActionPayload,
} from "../src/contracts/input/types";

import type {
  InputFrameScheduler,
} from "../src/engine/input/internal/InputFramePump";

import {
  createInputPlugin,
} from "../src/plugins/input/plugin";

describe(
  "Etapa 78 — input plugin lifecycle",
  () => {
    it(
      "inicia pump somente em kernel.booted, publica action e cancela RAF no stop",
      async (): Promise<void> => {
        let nextHandle =
          1;

        const callbacks =
          new Map<
            number,
            FrameRequestCallback
          >();

        const cancelled:
          number[] =
          [];

        const actions:
          InputActionPayload[] =
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

        const observer:
          Plugin = {
            manifest: {
              id:
                "test.input.observer",
              name:
                "Input Observer",
              version:
                "1.0.0",
              api:
                "^1.0.0",
              kind:
                "preloaded",
              permissions: {
                events: [
                  "game.input.action",
                ],
              },
            },

            setup(
              ctx:
                PluginContext,
            ): void {
              const unbind =
                ctx.events.on<
                  "game.input.action",
                  InputActionPayload
                >(
                  "game.input.action",
                  (
                    envelope,
                  ): void => {
                    actions.push(
                      envelope.payload,
                    );
                  },
                );

              ctx.lifecycle.onDispose(
                unbind,
              );

              ctx.lifecycle.ready();
            },
          };

        const kernel =
          new Kernel();

        kernel.register(
          createInputPlugin({
            frameScheduler:
              scheduler,
          }),
        );

        kernel.register(
          observer,
        );

        expect(
          callbacks.size,
        ).toBe(0);

        await kernel.boot();

        expect(
          callbacks.size,
        ).toBe(1);

        window.dispatchEvent(
          new KeyboardEvent(
            "keydown",
            {
              code:
                "Space",
            },
          ),
        );

        const first =
          callbacks.get(
            1,
          );

        if (
          first ===
          undefined
        ) {
          throw new Error(
            "RAF do input não foi agendado.",
          );
        }

        callbacks.delete(
          1,
        );

        first(
          16,
        );

        await kernel
          .__internal()
          .state
          .emitQueue
          .drain();

        expect(
          actions.some(
            (
              payload,
            ): boolean =>
              payload.action ===
                "Jump" &&
              payload.state ===
                "pressed" &&
              payload.device ===
                "keyboard_mouse",
          ),
        ).toBe(true);

        await kernel.stop();

        expect(
          cancelled,
        ).toEqual([
          2,
        ]);
      },
    );
  },
);
