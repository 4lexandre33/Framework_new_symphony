import fs from "node:fs";
import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  PRESENTATION_RUNTIME_FILES,
  auditLayer1Presentation,
} from "../scripts/architecture/lib/layer1-presentation-v1.mjs";

const ROOT =
  process.cwd();

function read(
  relativePath:
    string,
): string {
  return fs.readFileSync(
    path.join(
      ROOT,
      ...relativePath.split(
        "/",
      ),
    ),
    "utf8",
  );
}

describe(
  "Layer 1 Stage 80 — presentation certification",
  (): void => {
    it(
      "certifica exatamente os arquivos empacotados da baseline",
      (): void => {
        const baseline =
          JSON.parse(
            read(
              "LAYER1_PRESENTATION_BASELINE_V1.json",
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
            ...PRESENTATION_RUNTIME_FILES,
          ].sort(),
        );
      },
    );

    it(
      "não contém fallback 0.016 nem explicit any textual nos runtimes certificados",
      (): void => {
        for (
          const file of
          PRESENTATION_RUNTIME_FILES
        ) {
          const source =
            read(
              file,
            );

          expect(
            source.includes(
              "0.016",
            ),
            file,
          ).toBe(
            false,
          );

          expect(
            /\bany\b/u.test(
              source,
            ),
            file,
          ).toBe(
            false,
          );
        }
      },
    );

    it(
      "auditor completo permanece verde",
      async (): Promise<void> => {
        const result =
          await auditLayer1Presentation({
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
