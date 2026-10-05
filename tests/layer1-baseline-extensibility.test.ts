// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  compareLayer1BaselineCompatibility,
} from "../scripts/architecture/lib/layer1-baseline-v1.mjs";

const BASE_MODULE = Object.freeze({
  layer: 1,
  key: "render",
  displayName: "Render",
  category: "functional",
  firstParty: true,
  bootstrapped: true,
  capabilityId: "game.render",
  capabilityVersion: "1.0.0",
  engine: Object.freeze({
    directoryName: "render",
    root: "src/engine/render",
    publicRoot:
      "src/engine/render/public",
    internalRoot:
      "src/engine/render/internal",
    presentInStage3: true,
    implementationOrigin:
      "engine",
  }),
  contracts: Object.freeze([
    "src/contracts/render/types.ts",
  ]),
  tokens: Object.freeze([
    Object.freeze({
      path:
        "src/tokens/render.ts",
      capabilityId:
        "game.render",
      version:
        "1.0.0",
      primary:
        true,
    }),
  ]),
  plugin:
    "src/plugins/render/plugin.ts",
  nativeFiles:
    Object.freeze([]),
  tests:
    Object.freeze([
      "tests/render-system.test.ts",
    ]),
  extraFiles:
    Object.freeze([]),
});

const BASELINE = Object.freeze({
  modules: Object.freeze([
    BASE_MODULE,
  ]),
});

describe(
  "Etapa 71 — extensibilidade pós-certificação",
  () => {
    it(
      "permite nova capability oficialmente adicionada ao registry",
      () => {
        const newModule = {
          ...BASE_MODULE,
          layer: 21,
          key: "weather",
          displayName: "Weather",
          capabilityId:
            "game.weather",
          engine: {
            ...BASE_MODULE.engine,
            directoryName:
              "weather",
            root:
              "src/engine/weather",
            publicRoot:
              "src/engine/weather/public",
            internalRoot:
              "src/engine/weather/internal",
          },
          contracts: [
            "src/contracts/weather/types.ts",
          ],
          tokens: [
            {
              path:
                "src/tokens/weather.ts",
              capabilityId:
                "game.weather",
              version:
                "1.0.0",
              primary:
                true,
            },
          ],
          plugin:
            "src/plugins/weather/plugin.ts",
          tests: [
            "tests/weather-system.test.ts",
          ],
        };

        const result =
          compareLayer1BaselineCompatibility(
            BASELINE,
            [
              BASE_MODULE,
              newModule,
            ],
          );

        expect(result.ok)
          .toBe(true);

        expect(
          result.additionalModuleKeys,
        ).toEqual([
          "weather",
        ]);

        expect(
          result.preservedBaselineModules,
        ).toBe(1);
      },
    );

    it(
      "reprova remoção de módulo certificado pela baseline",
      () => {
        const result =
          compareLayer1BaselineCompatibility(
            BASELINE,
            [],
          );

        expect(result.ok)
          .toBe(false);

        expect(
          result.violations
            .some(
              (item) =>
                item.code ===
                "L1BASE001",
            ),
        ).toBe(true);
      },
    );

    it(
      "reprova troca silenciosa de capability identity",
      () => {
        const changed = {
          ...BASE_MODULE,
          capabilityId:
            "game.render.v2",
        };

        const result =
          compareLayer1BaselineCompatibility(
            BASELINE,
            [
              changed,
            ],
          );

        expect(result.ok)
          .toBe(false);

        expect(
          result.violations
            .some(
              (item) =>
                item.code ===
                "L1BASE002",
            ),
        ).toBe(true);
      },
    );

    it(
      "permite acrescentar novos arquivos declarados sem apagar os certificados",
      () => {
        const expanded = {
          ...BASE_MODULE,
          contracts: [
            ...BASE_MODULE
              .contracts,
            "src/contracts/render/diagnostics.ts",
          ],
          tests: [
            ...BASE_MODULE
              .tests,
            "tests/render-extra.test.ts",
          ],
        };

        const result =
          compareLayer1BaselineCompatibility(
            BASELINE,
            [
              expanded,
            ],
          );

        expect(result.ok)
          .toBe(true);
      },
    );
  },
);
