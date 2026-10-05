import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  PRESENTATION_RUNTIME_FILES,
} from "../scripts/architecture/lib/layer1-presentation-v1.mjs";

describe(
  "Layer 1 Stage 80 — audit selftest",
  (): void => {
    it(
      "baseline não certifica arquivo fora do pacote runtime",
      (): void => {
        const baseline =
          JSON.parse(
            fs.readFileSync(
              path.join(
                process.cwd(),
                "LAYER1_PRESENTATION_BASELINE_V1.json",
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
          new Set(
            Object.keys(
              baseline
                .semanticFingerprints,
            ),
          ).size,
        ).toBe(
          PRESENTATION_RUNTIME_FILES.length,
        );
      },
    );

    it(
      "lista de runtime não contém duplicatas",
      (): void => {
        const unique =
          new Set(
            PRESENTATION_RUNTIME_FILES,
          );

        expect(
          unique.size,
        ).toBe(
          PRESENTATION_RUNTIME_FILES.length,
        );
      },
    );

    it(
      "selftest usa diretório temporário gravável sem alterar o projeto",
      (): void => {
        const temp =
          fs.mkdtempSync(
            path.join(
              os.tmpdir(),
              "projeto1-stage80-",
            ),
          );

        const probe =
          path.join(
            temp,
            "probe.txt",
          );

        fs.writeFileSync(
          probe,
          "ok",
          "utf8",
        );

        expect(
          fs.readFileSync(
            probe,
            "utf8",
          ),
        ).toBe(
          "ok",
        );

        fs.rmSync(
          temp,
          {
            recursive:
              true,
            force:
              true,
          },
        );
      },
    );
  },
);
