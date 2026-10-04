// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  auditDomainPortability,
  PORTABILITY_GATE_VERSION,
} from "../scripts/architecture/lib/domain-portability-v2.mjs";

describe(
  "Etapa 66 — Portability Gate v2",
  () => {
    it(
      "mantém todo src/domain portátil e dimension-agnostic",
      () => {
        const result =
          auditDomainPortability({
            projectRoot:
              process.cwd(),
          });

        expect(
          result.version,
        ).toBe(
          PORTABILITY_GATE_VERSION,
        );

        expect(
          result.counts.files,
        ).toBeGreaterThan(
          100,
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
