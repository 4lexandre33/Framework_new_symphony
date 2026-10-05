// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  compareCapabilityGraphBaselineCompatibility,
} from "../scripts/architecture/lib/layer1-capability-graph-v1.mjs";

interface TestPluginRecord {
  id: string;
  version: string;
  kind: string;
  path: string;
  manifestSource: string;
}

interface TestProviderRecord {
  capabilityId: string;
  pluginId: string;
  kind: string;
  version: string;
  priority: number;
}

interface TestRequirementRecord {
  consumerPluginId: string;
  capabilityId: string;
  range: string;
  optional: boolean;
  providerPluginId: string;
  providerVersion: string;
  providerPriority: number;
}

interface TestGraph {
  composition: {
    activePlugins: TestPluginRecord[];
  };
  providers: TestProviderRecord[];
  resolvedRequirements: TestRequirementRecord[];
  bootOrder: string[];
}

const BASE_PLUGIN:
  TestPluginRecord = {
    id:
      "game.render",
    version:
      "1.0.0",
    kind:
      "preloaded",
    path:
      "src/plugins/render/plugin.ts",
    manifestSource:
      "export const renderManifest",
  };

const BASE_PROVIDER:
  TestProviderRecord = {
    capabilityId:
      "game.render",
    pluginId:
      "game.render",
    kind:
      "preloaded",
    version:
      "1.0.0",
    priority:
      0,
  };

const BASE_REQUIREMENT:
  TestRequirementRecord = {
    consumerPluginId:
      "game.vfx",
    capabilityId:
      "game.render",
    range:
      "^1.0.0",
    optional:
      false,
    providerPluginId:
      "game.render",
    providerVersion:
      "1.0.0",
    providerPriority:
      0,
  };

const BASELINE = {
  graph: {
    composition: {
      activePlugins: [
        BASE_PLUGIN,
      ],
    },
    providers: [
      BASE_PROVIDER,
    ],
    resolvedRequirements: [
      BASE_REQUIREMENT,
    ],
    bootOrder: [
      "game.render",
    ],
  },
};

function currentGraph():
  TestGraph {
  return {
    composition: {
      activePlugins: [
        {
          ...BASE_PLUGIN,
        },
      ],
    },
    providers: [
      {
        ...BASE_PROVIDER,
      },
    ],
    resolvedRequirements: [
      {
        ...BASE_REQUIREMENT,
      },
    ],
    bootOrder: [
      "game.render",
    ],
  };
}

describe(
  "Etapa 73 — capability graph policy self-test",
  () => {
    it(
      "permite novo plugin registrado sem apagar o grafo certificado",
      () => {
        const current =
          currentGraph();

        current.composition
          .activePlugins
          .push({
            id:
              "game.weather",
            version:
              "1.0.0",
            kind:
              "preloaded",
            path:
              "src/plugins/weather/plugin.ts",
            manifestSource:
              "export const weatherManifest",
          });

        current.providers
          .push({
            capabilityId:
              "game.weather",
            pluginId:
              "game.weather",
            kind:
              "preloaded",
            version:
              "1.0.0",
            priority:
              0,
          });

        current.bootOrder
          .push(
            "game.weather",
          );

        const result =
          compareCapabilityGraphBaselineCompatibility(
            BASELINE,
            current,
          );

        expect(result.ok)
          .toBe(true);

        expect(
          result.additionalActivePluginIds,
        ).toEqual([
          "game.weather",
        ]);
      },
    );

    it(
      "reprova remoção de provider certificado",
      () => {
        const current =
          currentGraph();

        current.providers =
          [];

        const result =
          compareCapabilityGraphBaselineCompatibility(
            BASELINE,
            current,
          );

        expect(result.ok)
          .toBe(false);

        expect(
          result.violations
            .some(
              (item) =>
                item.code ===
                "L1GRAPH003",
            ),
        ).toBe(true);
      },
    );

    it(
      "reprova reroute silencioso de requirement",
      () => {
        const current =
          currentGraph();

        current
          .resolvedRequirements =
          [
            {
              ...BASE_REQUIREMENT,
              providerPluginId:
                "game.render.alt",
            },
          ];

        const result =
          compareCapabilityGraphBaselineCompatibility(
            BASELINE,
            current,
          );

        expect(result.ok)
          .toBe(false);

        expect(
          result.violations
            .some(
              (item) =>
                item.code ===
                "L1GRAPH006",
            ),
        ).toBe(true);
      },
    );

    it(
      "reprova inversão da ordem relativa certificada",
      () => {
        const baseline = {
          graph: {
            ...BASELINE.graph,
            composition: {
              activePlugins: [
                {
                  ...BASE_PLUGIN,
                },
                {
                  ...BASE_PLUGIN,
                  id:
                    "game.vfx",
                  path:
                    "src/plugins/vfx/plugin.ts",
                },
              ],
            },
            bootOrder: [
              "game.render",
              "game.vfx",
            ],
          },
        };

        const current:
          TestGraph = {
            ...currentGraph(),
            composition: {
              activePlugins: [
                {
                  ...BASE_PLUGIN,
                },
                {
                  ...BASE_PLUGIN,
                  id:
                    "game.vfx",
                  path:
                    "src/plugins/vfx/plugin.ts",
                },
              ],
            },
            bootOrder: [
              "game.vfx",
              "game.render",
            ],
          };

        const result =
          compareCapabilityGraphBaselineCompatibility(
            baseline,
            current,
          );

        expect(result.ok)
          .toBe(false);

        expect(
          result.violations
            .some(
              (item) =>
                item.code ===
                "L1GRAPH007",
            ),
        ).toBe(true);
      },
    );
  },
);
