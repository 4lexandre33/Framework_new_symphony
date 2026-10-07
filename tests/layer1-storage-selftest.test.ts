import fs from "node:fs";
import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  STORAGE_RUNTIME_FILES,
  auditLayer1Storage,
} from "../scripts/architecture/lib/layer1-storage-v1.mjs";

const ROOT =
  process.cwd();

describe(
  "Layer 1 Stage 82 — storage audit selftest",
  (): void => {
    it(
      "lista certificada não possui duplicatas",
      (): void => {
        expect(
          new Set(
            STORAGE_RUNTIME_FILES,
          ).size,
        ).toBe(
          STORAGE_RUNTIME_FILES.length,
        );
      },
    );

    it(
      "baseline cobre exatamente os runtimes da Etapa 82",
      (): void => {
        const baseline =
          JSON.parse(
            fs.readFileSync(
              path.join(
                ROOT,
                "LAYER1_STORAGE_BASELINE_V1.json",
              ),
              "utf8",
            ),
          ) as {
            semanticFingerprints:
              Record<
                string,
                string
              >;
          };

        expect(
          Object.keys(
            baseline
              .semanticFingerprints,
          ).sort(),
        ).toEqual(
          [
            ...STORAGE_RUNTIME_FILES,
          ].sort(),
        );
      },
    );

    it(
      "auditor completo permanece verde",
      async (): Promise<void> => {
        const result =
          await auditLayer1Storage({
            projectRoot:
              ROOT,
          });

        expect(
          result.ok,
          JSON.stringify(
            result.violations,
            null,
            2,
          ),
        ).toBe(
          true,
        );
      },
    );
  },
);
