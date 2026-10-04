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

const RELATIONS_DIR =
  path.join(
    ROOT,
    "src",
    "domain",
    "relations",
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
    "vector2",
    "vector3",
    "object3d",
    "sprite",
    "mesh",
    "currencyaccount",
    "rewardpolicy",
    "loottable",
    "craftingrecipe",
  ]);

describe(
  "Etapa 55 — Relations purity gate",
  () => {
    it(
      "domain/relations não depende de stack técnica nem Economy futura",
      () => {
        const files =
          fs.readdirSync(
            RELATIONS_DIR,
          )
            .filter(
              (name) =>
                name.endsWith(
                  ".ts",
                ),
            )
            .sort();

        expect(
          files.length,
        ).toBeGreaterThan(0);

        for (
          const file of files
        ) {
          const source =
            fs.readFileSync(
              path.join(
                RELATIONS_DIR,
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
