// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  auditLayer1Baseline,
  LAYER1_BASELINE_AUDIT_VERSION,
} from "../scripts/architecture/lib/layer1-baseline-v1.mjs";

describe(
  "Etapa 71 — Layer 1 Baseline & Inventory",
  () => {
    it(
      "certifica a baseline v1 atual sem transformar 23 em limite permanente",
      async () => {
        const result =
          await auditLayer1Baseline({
            projectRoot:
              process.cwd(),
          });

        expect(
          result.version,
        ).toBe(
          LAYER1_BASELINE_AUDIT_VERSION,
        );

        expect(
          result.baselineId,
        ).toBe(
          "layer1-v1-stage71",
        );

        expect(
          result.capturedCounts
            .canonicalModules,
        ).toBe(23);

        expect(
          result.capturedCounts
            .functionalModules,
        ).toBe(20);

        expect(
          result.capturedCounts
            .runtimeModules,
        ).toBe(3);

        expect(
          result.currentCounts
            .canonicalModules,
        ).toBeGreaterThanOrEqual(
          result.capturedCounts
            .canonicalModules,
        );

        expect(
          result.compatibility
            .preservedBaselineModules,
        ).toBe(
          result.compatibility
            .baselineModuleCount,
        );

        expect(
          result.policy
            .additionalCanonicalModulesAllowed,
        ).toBe(true);

        expect(
          result.policy
            .moduleCountAtCaptureIsNotAPermanentLimit,
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
