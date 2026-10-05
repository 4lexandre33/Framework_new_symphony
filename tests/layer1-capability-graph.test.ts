// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  auditLayer1CapabilityGraph,
  LAYER1_CAPABILITY_GRAPH_AUDIT_VERSION,
} from "../scripts/architecture/lib/layer1-capability-graph-v1.mjs";

describe(
  "Etapa 73 — Plugin Manifests & Capability Graph",
  () => {
    it(
      "certifica o grafo ativo da Camada 1",
      async () => {
        const result =
          await auditLayer1CapabilityGraph({
            projectRoot:
              process.cwd(),
          });

        expect(
          result.version,
        ).toBe(
          LAYER1_CAPABILITY_GRAPH_AUDIT_VERSION,
        );

        expect(
          result.baselineId,
        ).toBe(
          "layer1-capability-graph-v1-stage73",
        );

        expect(
          result.registry
            .canonicalModules,
        ).toBeGreaterThanOrEqual(
          23,
        );

        expect(
          result.currentCounts
            .activePlugins,
        ).toBeGreaterThanOrEqual(
          result.registry
            .canonicalModules,
        );

        expect(
          result.currentCounts
            .cycles,
        ).toBe(0);

        expect(
          result.currentCounts
            .providerAmbiguities,
        ).toBe(0);

        expect(
          result.compatibility
            .stage71,
        ).toBe(true);

        expect(
          result.compatibility
            .stage72,
        ).toBe(true);

        expect(
          result.compatibility
            .graphBaseline,
        ).toBe(true);

        expect(
          result.policy
            .canonicalCountDerivedFromModuleMap,
        ).toBe(true);

        expect(
          result.policy
            .additionalRegisteredPluginsAllowed,
        ).toBe(true);

        expect(
          result.policy
            .dependencyCheckerReadOnly,
        ).toBe(true);

        expect(
          result.violations,
          result.violations
            .map(
              (item) =>
                `[${item.code}] ${item.scope} — ${item.message}`,
            )
            .join("\n"),
        ).toEqual([]);

        expect(result.ok)
          .toBe(true);
      },
    );
  },
);
