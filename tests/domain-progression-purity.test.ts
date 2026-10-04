// @vitest-environment node

import fs from "node:fs";
import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

const ROOT =
  process.cwd();

const PROGRESSION_DIR =
  path.join(
    ROOT,
    "src",
    "domain",
    "progression",
  );

const FORBIDDEN_PATTERNS =
  Object.freeze([
    "src/core",
    "src/engine",
    "src/services",
    "src/app",
    "src/plugins",
    "from \"@core",
    "from '@core",
    "three",
    "babylon",
    "rapier",
    "@tauri",
    "steamworks",
    "math.random",
    "date.now",
    "performance.now",
    "vector2",
    "vector3",
    "object3d",
    "sprite",
    "mesh",
    "questdefinition",
    "queststate",
    "narrativestate",
    "storyflagset",
  ]);

describe(
  "Etapa 57 — Progression purity gate",
  () => {
    it(
      "domain/progression não depende de stack técnica nem Narrative futura",
      () => {
        const sourceFiles =
          fs.readdirSync(
            PROGRESSION_DIR,
          )
            .filter(
              (name) =>
                name.endsWith(
                  ".ts",
                ),
            )
            .sort();

        expect(
          sourceFiles.length,
        ).toBeGreaterThan(0);

        for (
          const file of
          sourceFiles
        ) {
          const source =
            fs.readFileSync(
              path.join(
                PROGRESSION_DIR,
                file,
              ),
              "utf8",
            );

          const normalized =
            source.toLowerCase();

          for (
            const pattern of
            FORBIDDEN_PATTERNS
          ) {
            expect(
              normalized.includes(
                pattern,
              ),
              `${file} contém padrão proibido: ${pattern}`,
            ).toBe(false);
          }
        }
      },
    );
  },
);
