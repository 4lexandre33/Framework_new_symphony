import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  WORLD_AI_SCRIPTING_HOT_PATHS,
  WORLD_AI_SCRIPTING_RUNTIME_FILES,
} from "../scripts/architecture/lib/layer1-world-ai-scripting-v1.mjs";

describe(
  "Layer 1 Stage 81 — audit selftest",
  (): void => {
    it(
      "runtime e hot paths não possuem entradas duplicadas",
      (): void => {
        expect(
          new Set(
            WORLD_AI_SCRIPTING_RUNTIME_FILES,
          ).size,
        ).toBe(
          WORLD_AI_SCRIPTING_RUNTIME_FILES.length,
        );

        const hotPathNames =
          WORLD_AI_SCRIPTING_HOT_PATHS.map(
            ([, className, methodName]) =>
              `${className}.${methodName}`,
          );

        expect(
          new Set(
            hotPathNames,
          ).size,
        ).toBe(
          hotPathNames.length,
        );
      },
    );

    it(
      "baseline declara Stage 81 sem antecipar Stage 82",
      (): void => {
        const baseline =
          JSON.parse(
            fs.readFileSync(
              path.join(
                process.cwd(),
                "LAYER1_WORLD_AI_SCRIPTING_BASELINE_V1.json",
              ),
              "utf8",
            ),
          ) as {
            stage: number;
            deferredToStage82:
              string[];
          };

        expect(
          baseline.stage,
        ).toBe(
          81,
        );

        expect(
          baseline.deferredToStage82,
        ).toContain(
          "src/engine/world/internal/SaveSystem.ts",
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
              "projeto1-stage81-",
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
