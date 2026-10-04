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

const EVALUATION_DIR =
  path.join(
    ROOT,
    "src",
    "domain",
    "evaluation",
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
    "requestanimationframe",
    "performance.now",
    "date.now",
    "math.random",
    "eval(",
    "new function(",
  ]);

describe(
  "Etapa 50 — Conditions purity gate",
  () => {
    it(
      "domain/evaluation não depende de stack técnica ou execução arbitrária",
      () => {
        const files =
          fs.readdirSync(
            EVALUATION_DIR,
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
                EVALUATION_DIR,
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
