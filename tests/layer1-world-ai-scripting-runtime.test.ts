import fs from "node:fs";
import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  STAGE82_DEFERRED_WORLD_FILES,
  WORLD_AI_SCRIPTING_RUNTIME_FILES,
  auditLayer1WorldAIScripting,
} from "../scripts/architecture/lib/layer1-world-ai-scripting-v1.mjs";

const ROOT =
  process.cwd();

function read(
  relativePath: string,
): string {
  return fs.readFileSync(
    path.join(
      ROOT,
      ...relativePath.split("/"),
    ),
    "utf8",
  );
}

describe(
  "Layer 1 Stage 81 — World/AI/Scripting certification",
  (): void => {
    it(
      "baseline certifica exatamente o conjunto runtime da Etapa 81",
      (): void => {
        const baseline =
          JSON.parse(
            read(
              "LAYER1_WORLD_AI_SCRIPTING_BASELINE_V1.json",
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
            ...WORLD_AI_SCRIPTING_RUNTIME_FILES,
          ].sort(),
        );
      },
    );

    it(
      "runtimes certificados não contêm explicit any nem import direto de Domain",
      (): void => {
        for (
          const file of
          WORLD_AI_SCRIPTING_RUNTIME_FILES
        ) {
          const source =
            read(
              file,
            );

          expect(
            /\bany\b/u.test(
              source,
            ),
            file,
          ).toBe(
            false,
          );

          expect(
            /(?:@domain|src\/domain|\/domain\/)/u.test(
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
      "SaveSystem permanece explicitamente reservado à Etapa 82",
      (): void => {
        expect(
          STAGE82_DEFERRED_WORLD_FILES,
        ).toEqual([
          "src/engine/world/internal/SaveSystem.ts",
        ]);

        expect(
          WORLD_AI_SCRIPTING_RUNTIME_FILES,
        ).not.toContain(
          "src/engine/world/internal/SaveSystem.ts",
        );
      },
    );

    it(
      "auditor completo permanece verde",
      async (): Promise<void> => {
        const result =
          await auditLayer1WorldAIScripting({
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
