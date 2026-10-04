// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  LAYER2_FINAL_EXPECTED_DOMAIN_ROOTS,
  LAYER2_FINAL_STAGE_CHECKPOINTS,
} from "../scripts/architecture/lib/layer2-final-gate-v1.mjs";

describe(
  "Etapa 70 — final gate catalog self-test",
  () => {
    it(
      "catálogo cobre exatamente Stages 44–69 sem lacunas",
      () => {
        expect(
          LAYER2_FINAL_STAGE_CHECKPOINTS.map(
            (entry) =>
              entry.stage,
          ),
        ).toEqual(
          Array.from(
            {
              length: 26,
            },
            (
              _,
              index,
            ) =>
              String(
                index + 44,
              ),
          ),
        );
      },
    );

    it(
      "cada stage possui checkpoints únicos e não vazios",
      () => {
        const allPaths:
          string[] = [];

        for (
          const checkpoint of
          LAYER2_FINAL_STAGE_CHECKPOINTS
        ) {
          expect(
            checkpoint.files.length,
            `Stage ${checkpoint.stage}`,
          ).toBeGreaterThan(
            0,
          );

          expect(
            new Set(
              checkpoint.files,
            ).size,
          ).toBe(
            checkpoint.files.length,
          );

          allPaths.push(
            ...checkpoint.files,
          );
        }

        expect(
          new Set(
            allPaths,
          ).size,
        ).toBe(
          allPaths.length,
        );
      },
    );

    it(
      "root catalog final permanece canônico e sem duplicação",
      () => {
        expect(
          LAYER2_FINAL_EXPECTED_DOMAIN_ROOTS,
        ).toEqual([
          "definitions",
          "economy",
          "entities",
          "evaluation",
          "events",
          "integration",
          "interaction",
          "location",
          "mechanics",
          "narrative",
          "ports",
          "progression",
          "random",
          "relations",
          "snapshots",
          "state",
          "tags",
          "time",
        ]);

        expect(
          new Set(
            LAYER2_FINAL_EXPECTED_DOMAIN_ROOTS,
          ).size,
        ).toBe(18);
      },
    );
  },
);
