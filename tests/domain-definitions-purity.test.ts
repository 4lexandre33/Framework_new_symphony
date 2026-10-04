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

const DEFINITIONS_DIR =
  path.join(
    ROOT,
    "src",
    "domain",
    "definitions",
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
    "requestanimationframe",
    "vector2",
    "vector3",
    "object3d",
    "sprite",
    "mesh",
    "domain-tag",
    "tag-set",
  ]);

describe(
  "Etapa 60 — Definitions purity gate",
  () => {
    it(
      "domain/definitions não depende de stack técnica nem etapa 61",
      () => {
        const sourceFiles =
          fs.readdirSync(
            DEFINITIONS_DIR,
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
                DEFINITIONS_DIR,
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
