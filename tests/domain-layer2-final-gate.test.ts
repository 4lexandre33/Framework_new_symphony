// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  auditLayer2FinalGate,
  LAYER2_FINAL_EXPECTED_DOMAIN_ROOTS,
  LAYER2_FINAL_GATE_VERSION,
  LAYER2_FINAL_STAGE_CHECKPOINTS,
} from "../scripts/architecture/lib/layer2-final-gate-v1.mjs";

describe(
  "Etapa 70 — FINAL LAYER 2 GATE",
  () => {
    it(
      "certifica checkpoints 44–69 e todos os gates executáveis",
      () => {
        const result =
          auditLayer2FinalGate({
            projectRoot:
              process.cwd(),
          });

        expect(
          result.version,
        ).toBe(
          LAYER2_FINAL_GATE_VERSION,
        );

        expect(
          result.stageRange,
        ).toEqual({
          first: 44,
          last: 69,
          count: 26,
        });

        expect(
          LAYER2_FINAL_STAGE_CHECKPOINTS,
        ).toHaveLength(26);

        expect(
          LAYER2_FINAL_EXPECTED_DOMAIN_ROOTS,
        ).toHaveLength(18);

        expect(
          result.counts.checkpointFiles,
        ).toBeGreaterThan(
          50,
        );

        expect(
          result.gates,
        ).toEqual({
          checkpoints: true,
          portability: true,
          performance: true,
          invariants: true,
          documentation: true,
        });

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
