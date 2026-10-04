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

const RANDOM_DIR =
  path.join(
    ROOT,
    "src",
    "domain",
    "random",
  );

const FORBIDDEN_PATTERNS =
  Object.freeze([
    "src/core",
    "src/engine",
    "src/services",
    "src/app",
    "src/plugins",
    "src/domain/ports",
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
    "crypto.",
    "randomvalues",
    "randombytes",
  ]);

describe(
  "Etapa 64 — Deterministic RNG purity gate",
  () => {
    it(
      "random não usa entropia externa, stack técnica ou ports",
      () => {
        const sourceFiles =
          fs.readdirSync(
            RANDOM_DIR,
          )
            .filter(
              (name) =>
                name.endsWith(
                  ".ts",
                ),
            )
            .sort();

        expect(
          sourceFiles,
        ).toEqual([
          "DeterministicRng.ts",
          "RandomSeed.ts",
          "RandomSnapshotCodecs.ts",
          "RandomStream.ts",
          "index.ts",
        ]);

        for (
          const file of
          sourceFiles
        ) {
          const source =
            fs.readFileSync(
              path.join(
                RANDOM_DIR,
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
