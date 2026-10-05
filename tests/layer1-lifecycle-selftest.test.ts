// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  compareLifecycleBaselineCompatibility,
} from "../scripts/architecture/lib/layer1-lifecycle-v1.mjs";

const CORE =
  Object.freeze([
    Object.freeze({
      path:
        "src/core/runtime/boot.ts",
      fingerprint:
        "boot-a",
    }),
    Object.freeze({
      path:
        "src/core/runtime/stop.ts",
      fingerprint:
        "stop-a",
    }),
  ]);

const PLUGIN =
  Object.freeze({
    id:
      "game.render",
    path:
      "src/plugins/render/plugin.ts",
    readyCalls:
      1,
    onDisposeCalls:
      1,
    hasOnBootHook:
      false,
    hasOnStopHook:
      false,
  });

const BASELINE =
  Object.freeze({
    plugins:
      Object.freeze([
        PLUGIN,
      ]),
    coreRuntimeFiles:
      CORE,
  });

describe(
  "Etapa 74 — lifecycle baseline self-test",
  () => {
    it(
      "permite novo plugin sem invalidar lifecycle existente",
      () => {
        const result =
          compareLifecycleBaselineCompatibility(
            BASELINE,
            {
              plugins: [
                PLUGIN,
                {
                  id:
                    "game.weather",
                  path:
                    "src/plugins/weather/plugin.ts",
                  readyCalls:
                    1,
                  onDisposeCalls:
                    1,
                  hasOnBootHook:
                    true,
                  hasOnStopHook:
                    false,
                },
              ],
              coreRuntimeFiles:
                CORE,
            },
          );

        expect(result.ok)
          .toBe(true);

        expect(
          result.additionalPluginIds,
        ).toEqual([
          "game.weather",
        ]);
      },
    );

    it(
      "reprova alteração silenciosa no lifecycle de plugin certificado",
      () => {
        const result =
          compareLifecycleBaselineCompatibility(
            BASELINE,
            {
              plugins: [
                {
                  ...PLUGIN,
                  onDisposeCalls:
                    0,
                },
              ],
              coreRuntimeFiles:
                CORE,
            },
          );

        expect(result.ok)
          .toBe(false);

        expect(
          result.violations
            .some(
              (item) =>
                item.code ===
                "L1LIFE002",
            ),
        ).toBe(true);
      },
    );

    it(
      "reprova alteração sem recertificação no runtime lifecycle do Core",
      () => {
        const result =
          compareLifecycleBaselineCompatibility(
            BASELINE,
            {
              plugins: [
                PLUGIN,
              ],
              coreRuntimeFiles: [
                {
                  path:
                    "src/core/runtime/boot.ts",
                  fingerprint:
                    "boot-changed",
                },
                CORE[1],
              ],
            },
          );

        expect(result.ok)
          .toBe(false);

        expect(
          result.violations
            .some(
              (item) =>
                item.code ===
                "L1LIFE004",
            ),
        ).toBe(true);
      },
    );
  },
);
