import {
  describe,
  expect,
  it,
} from "vitest";

import {
  AnimationState,
} from "../src/engine/anim/internal/AnimationState";

import {
  AnimationStateMachine,
} from "../src/engine/anim/internal/AnimationStateMachine";

import {
  Sprite2DAnimationDriver,
} from "../src/engine/anim/internal/Sprite2DAnimationDriver";

describe(
  "Layer 1 Stage 80 — Animation presentation",
  (): void => {
    it(
      "clampa stalls a 250ms na FSM",
      (): void => {
        const fsm =
          new AnimationStateMachine();

        fsm.addState(
          new AnimationState(
            "idle",
            "idle",
            1,
          ),
        );

        fsm.update(
          10,
        );

        expect(
          fsm.getCurrentNormalizedTime(),
        ).toBeCloseTo(
          0.25,
          5,
        );
      },
    );

    it(
      "normaliza estado inválido sem contaminar a FSM",
      (): void => {
        const state =
          new AnimationState(
            " idle ",
            " idle_clip ",
            Number.NaN,
            Number.NaN,
          );

        expect(
          state.name,
        ).toBe(
          "idle",
        );

        expect(
          state.clipId,
        ).toBe(
          "idle_clip",
        );

        expect(
          state.durationSeconds,
        ).toBe(
          1,
        );

        expect(
          state.timeScale,
        ).toBe(
          1,
        );
      },
    );

    it(
      "sprite driver não processa mais de 250ms por update",
      (): void => {
        const driver =
          new Sprite2DAnimationDriver();

        const map = {
          offset: {
            x:
              0,
            y:
              0,
            set(
              x:
                number,
              y:
                number,
            ): void {
              this.x =
                x;
              this.y =
                y;
            },
          },

          repeat: {
            x:
              1,
            y:
              1,
            set(
              x:
                number,
              y:
                number,
            ): void {
              this.x =
                x;
              this.y =
                y;
            },
          },
        };

        driver.register(
          "hero",
          {
            map,
          },
          [
            {
              frameIndex:
                0,
              durationMs:
                200,
              uvOffset: {
                x:
                  0,
                y:
                  0,
              },
              uvScale: {
                x:
                  0.5,
                y:
                  1,
              },
            },
            {
              frameIndex:
                1,
              durationMs:
                200,
              uvOffset: {
                x:
                  0.5,
                y:
                  0,
              },
              uvScale: {
                x:
                  0.5,
                y:
                  1,
              },
            },
          ],
        );

        driver.update(
          10,
        );

        expect(
          driver.getCurrentFrameIndex(
            "hero",
          ),
        ).toBe(
          1,
        );
      },
    );
  },
);
