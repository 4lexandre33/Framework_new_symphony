// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  compareGameLoopBaselineCompatibility,
} from "../scripts/architecture/lib/layer1-game-loop-v1.mjs";

const BASELINE = {
  files: [
    {
      path:
        "src/engine/game-loop/internal/DeterministicGameLoop.ts",
      fingerprint:
        "loop-a",
    },
  ],
  constants: {
    GAME_LOOP_DEFAULT_TICK_RATE:
      60,
    GAME_LOOP_MAX_FRAME_DELTA_SECONDS:
      0.25,
  },
};

describe(
  "Etapa 75 — game loop baseline self-test",
  () => {
    it(
      "aceita baseline sem alteração",
      () => {
        const result =
          compareGameLoopBaselineCompatibility(
            BASELINE,
            {
              files: [
                {
                  path:
                    "src/engine/game-loop/internal/DeterministicGameLoop.ts",
                  fingerprint:
                    "loop-a",
                },
              ],
              constants: {
                GAME_LOOP_DEFAULT_TICK_RATE:
                  60,
                GAME_LOOP_MAX_FRAME_DELTA_SECONDS:
                  0.25,
              },
            },
          );

        expect(result.ok)
          .toBe(true);
      },
    );

    it(
      "reprova mudança sem recertificação na implementação",
      () => {
        const result =
          compareGameLoopBaselineCompatibility(
            BASELINE,
            {
              files: [
                {
                  path:
                    "src/engine/game-loop/internal/DeterministicGameLoop.ts",
                  fingerprint:
                    "loop-b",
                },
              ],
              constants: {
                GAME_LOOP_DEFAULT_TICK_RATE:
                  60,
                GAME_LOOP_MAX_FRAME_DELTA_SECONDS:
                  0.25,
              },
            },
          );

        expect(result.ok)
          .toBe(false);
        expect(
          result.violations
            .some(
              (item) =>
                item.code ===
                "L1LOOP002",
            ),
        ).toBe(true);
      },
    );

    it(
      "reprova mudança silenciosa de constante determinística",
      () => {
        const result =
          compareGameLoopBaselineCompatibility(
            BASELINE,
            {
              files: [
                {
                  path:
                    "src/engine/game-loop/internal/DeterministicGameLoop.ts",
                  fingerprint:
                    "loop-a",
                },
              ],
              constants: {
                GAME_LOOP_DEFAULT_TICK_RATE:
                  120,
                GAME_LOOP_MAX_FRAME_DELTA_SECONDS:
                  0.25,
              },
            },
          );

        expect(result.ok)
          .toBe(false);
        expect(
          result.violations
            .some(
              (item) =>
                item.code ===
                "L1LOOP003",
            ),
        ).toBe(true);
      },
    );
  },
);
