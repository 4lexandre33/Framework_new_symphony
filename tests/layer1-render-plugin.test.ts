// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  Kernel,
  type Plugin,
  type PluginContext,
} from "@core";

import type {
  RenderFramePayload,
  ViewportDimensions,
} from "../src/contracts/render/types";

import type { ThreeRenderEngine } from "../src/engine/render/internal/ThreeRenderEngine";

import { createRenderPlugin } from "../src/plugins/render/plugin";

class FakeRenderEngine {
  public renderCalls:
    RenderFramePayload[] = [];

  public disposed =
    0;

  private resizeCallback:
    ((
      dimensions:
        Readonly<ViewportDimensions>,
    ) => void) |
    null = null;

  public render(
    alphaInterpolation: number,
    deltaSeconds: number,
  ): void {
    this.renderCalls.push({
      alphaInterpolation,
      deltaSeconds,
    });
  }

  public onViewportResize(
    callback:
      (
        dimensions:
          Readonly<ViewportDimensions>,
      ) => void,
  ): () => void {
    this.resizeCallback =
      callback;

    return (): void => {
      this.resizeCallback =
        null;
    };
  }

  public triggerResize(
    dimensions:
      Readonly<ViewportDimensions>,
  ): void {
    this.resizeCallback?.(
      dimensions,
    );
  }

  public setCameraMode(): void {}

  public dispose(): void {
    this.disposed +=
      1;
  }
}

function driverManifest():
  Plugin["manifest"] {
  return {
    id:
      "test.render.driver",
    name:
      "Render Driver",
    version:
      "1.0.0",
    api:
      "^1.0.0",
    kind:
      "preloaded",
    dependsOn: [
      {
        id:
          "game.render",
        range:
          "^1.0.0",
      },
    ],
    permissions: {
      events: [
        "game.loop.render",
      ],
    },
  };
}

describe(
  "Etapa 76 — render plugin integration",
  () => {
    it(
      "renderiza loop frame, publica game.render.frame e game.render.resize",
      async (): Promise<void> => {
        const fake =
          new FakeRenderEngine();

        const driverState: {
          emitFrame?: (
            payload:
              RenderFramePayload,
          ) => Promise<void>;
        } = {};

        const frames:
          RenderFramePayload[] =
          [];

        const resizes:
          ViewportDimensions[] =
          [];

        const driver:
          Plugin = {
            manifest:
              driverManifest(),

            setup(
              ctx:
                PluginContext,
            ): void {
              ctx.events.on<
                "game.render.frame",
                RenderFramePayload
              >(
                "game.render.frame",
                (
                  event,
                ): void => {
                  frames.push(
                    event.payload,
                  );
                },
              );

              ctx.events.on<
                "game.render.resize",
                ViewportDimensions
              >(
                "game.render.resize",
                (
                  event,
                ): void => {
                  resizes.push(
                    event.payload,
                  );
                },
              );

              driverState.emitFrame =
                (
                  payload:
                    RenderFramePayload,
                ): Promise<void> =>
                  ctx.events.emitAsync(
                    "game.loop.render",
                    payload,
                  );

              ctx.lifecycle.ready();
            },
          };

        const kernel =
          new Kernel();

        kernel.register(
          createRenderPlugin(
            (): ThreeRenderEngine =>
              fake as unknown as ThreeRenderEngine,
          ),
        );

        kernel.register(
          driver,
        );

        await kernel.boot();

        const emitFrame =
          driverState.emitFrame;

        if (
          emitFrame ===
          undefined
        ) {
          throw new Error(
            "driver não inicializado.",
          );
        }

        const payload:
          RenderFramePayload = {
            alphaInterpolation:
              0.25,
            deltaSeconds:
              1 /
              60,
          };

        await emitFrame(
          payload,
        );

        expect(
          fake.renderCalls,
        ).toEqual([
          payload,
        ]);

        expect(frames)
          .toEqual([
            payload,
          ]);

        fake.triggerResize({
          width:
            800,
          height:
            600,
          aspectRatio:
            4 /
            3,
          pixelRatio:
            2,
        });

        await kernel
          .__internal()
          .state
          .emitQueue
          .drain();

        expect(resizes)
          .toEqual([
            {
              width:
                800,
              height:
                600,
              aspectRatio:
                4 /
                3,
              pixelRatio:
                2,
            },
          ]);

        await kernel.stop();

        expect(
          fake.disposed,
        ).toBe(1);
      },
    );
  },
);
