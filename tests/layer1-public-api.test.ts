// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  auditLayer1PublicApi,
  LAYER1_PUBLIC_API_AUDIT_VERSION,
} from "../scripts/architecture/lib/layer1-public-api-v1.mjs";

describe(
  "Etapa 72 — Public APIs / Contracts / Tokens",
  () => {
    it(
      "certifica a superfície pública atual da Camada 1",
      async () => {
        const result =
          await auditLayer1PublicApi({
            projectRoot:
              process.cwd(),
          });

        expect(
          result.version,
        ).toBe(
          LAYER1_PUBLIC_API_AUDIT_VERSION,
        );

        expect(
          result.baselineId,
        ).toBe(
          "layer1-public-api-v1-stage72",
        );

        expect(
          result.capturedModuleCount,
        ).toBe(23);

        expect(
          result.currentModuleCount,
        ).toBeGreaterThanOrEqual(
          23,
        );

        expect(
          result.counts.publicFacades,
        ).toBe(
          result.currentModuleCount,
        );

        expect(
          result.counts.contracts,
        ).toBeGreaterThanOrEqual(
          24,
        );

        expect(
          result.counts.tokens,
        ).toBeGreaterThanOrEqual(
          24,
        );

        expect(
          result.counts
            .secondaryCapabilities,
        ).toBeGreaterThanOrEqual(
          1,
        );

        expect(
          result.compatibility
            .stage71Baseline,
        ).toBe(true);

        expect(
          result.compatibility
            .publicApiBaseline,
        ).toBe(true);

        expect(
          result.policy
            .additionalCanonicalModulesAllowed,
        ).toBe(true);

        expect(
          result.policy
            .existingBaselineApiChangesRequireRecertification,
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
