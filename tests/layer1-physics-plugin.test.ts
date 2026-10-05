// @vitest-environment node

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
  GameTickPayload,
} from "../src/contracts/game-loop/types";

import {
  GameTickEvent,
} from "../src/contracts/game-loop/types";

import type {
  PhysicsPluginService,
} from "../src/plugins/physics/plugin";

import {
  createPhysicsPlugin,
} from "../src/plugins/physics/plugin";

function createFakeService(
  steps:
    number[],
  disposeCount: {
    value:
      number;
  },
): PhysicsPluginService {
  return {
    async initialize():
      Promise<boolean> {
      return true;
    },

    step(): void {},

    async stepForGameLoop(
      deltaTimeSeconds:
        number,
    ): Promise<void> {
      steps.push(
        deltaTimeSeconds,
      );
    },

    createBody():
      boolean {
      return true;
    },

    removeBody():
      boolean {
      return true;
    },

    applyImpulse():
      boolean {
      return true;
    },

    applyForce():
      boolean {
      return true;
    },

    castRay() {
      return {
        hit:
          false,
        distance:
          0,
        point: {
          x:
            0,
          y:
            0,
          z:
            0,
        },
        normal: {
          x:
            0,
          y:
            0,
          z:
            0,
        },
      };
    },

    getBodyTransform() {
      return null;
    },

    syncMeshTransform():
      boolean {
      return false;
    },

    setGravity(): void {},

    getStats() {
      return {
        rigidBodyCount:
          0,
        colliderCount:
          0,
        stepTimeMs:
          0,
        isWasmLoaded:
          true,
      };
    },

    dispose(): void {
      disposeCount.value +=
        1;
    },
  };
}

describe(
  "Etapa 77 — physics plugin / game.loop integration",
  () => {
    it(
      "consome exatamente GameTickPayload.deltaSeconds",
      async (): Promise<void> => {
        const steps:
          number[] =
          [];

        const disposeCount = {
          value:
            0,
        };

        const driverState: {
          emitTick?: (
            payload:
              GameTickPayload,
          ) =>
            Promise<void>;
        } = {};

        const driver:
          Plugin = {
            manifest: {
              id:
                "test.physics.driver",
              name:
                "Physics Tick Driver",
              version:
                "1.0.0",
              api:
                "^1.0.0",
              kind:
                "preloaded",
              permissions: {
                events: [
                  "game.loop.tick",
                ],
              },
            },

            setup(
              ctx:
                PluginContext,
            ): void {
              ctx.events.define(
                GameTickEvent,
              );

              driverState.emitTick =
                (
                  payload,
                ): Promise<void> =>
                  ctx.events.emitAsync(
                    GameTickEvent.type,
                    payload,
                  );

              ctx.lifecycle.ready();
            },
          };

        const kernel =
          new Kernel();

        kernel.register(
          createPhysicsPlugin(
            (): PhysicsPluginService =>
              createFakeService(
                steps,
                disposeCount,
              ),
          ),
        );

        kernel.register(
          driver,
        );

        await kernel.boot();

        const emitTick =
          driverState.emitTick;

        if (
          emitTick ===
          undefined
        ) {
          throw new Error(
            "tick driver não inicializado.",
          );
        }

        await emitTick({
          deltaSeconds:
            1 /
            120,
          totalTimeSeconds:
            5,
          tickCount:
            600,
        });

        expect(steps)
          .toEqual([
            1 /
            120,
          ]);

        await kernel.stop();

        expect(
          disposeCount.value,
        ).toBe(1);
      },
    );
  },
);
