// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  auditDomainPerformance,
  DOMAIN_PERFORMANCE_AUDIT_VERSION,
} from "../scripts/architecture/lib/domain-performance-v1.mjs";

import {
  DOMAIN_PERFORMANCE_POLICY_VERSION,
} from "../scripts/architecture/lib/domain-performance-policy-v1.mjs";

describe(
  "Etapa 67 — Performance Audit",
  () => {
    it(
      "mantém hot paths e lifecycles dentro da política v1",
      () => {
        const result =
          auditDomainPerformance({
            projectRoot:
              process.cwd(),
          });

        expect(
          result.version,
        ).toBe(
          DOMAIN_PERFORMANCE_AUDIT_VERSION,
        );

        expect(
          result.policyVersion,
        ).toBe(
          DOMAIN_PERFORMANCE_POLICY_VERSION,
        );

        expect(
          result.counts.hotMethods,
        ).toBeGreaterThanOrEqual(
          30,
        );

        expect(
          result.counts.lifecycleMethods,
        ).toBeGreaterThanOrEqual(
          15,
        );

        expect(
          result.violations,
          result.violations
            .map(
              (item) =>
                `[${item.rule}] ${item.file}:${String(item.line)} — ${item.message}`,
            )
            .join("\n"),
        ).toEqual([]);

        expect(result.ok)
          .toBe(true);
      },
    );
  },
);
