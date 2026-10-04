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

const SNAPSHOTS_DIR =
  path.join(
    ROOT,
    "src",
    "domain",
    "snapshots",
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
    "window.",
    "document.",
    "localstorage",
    "randomseed",
    "deterministicrng",
    "randomstream",
  ]);

describe(
  "Etapa 63 — Snapshots purity gate",
  () => {
    it(
      "snapshot framework permanece puro e não antecipa RNG da Etapa 64",
      () => {
        const sourceFiles =
          fs.readdirSync(
            SNAPSHOTS_DIR,
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
                SNAPSHOTS_DIR,
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
