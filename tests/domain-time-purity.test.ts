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

const TIME_DIR =
  path.join(
    ROOT,
    "src",
    "domain",
    "time",
  );

const FORBIDDEN_PATTERNS =
  Object.freeze([
    "Date.now",
    "performance.now",
    "requestAnimationFrame",
    "setTimeout(",
    "setInterval(",
    "src/engine",
    "src/services",
    "src/app",
    "src/plugins",
    "three",
    "babylon",
    "rapier",
    "@tauri",
    "steamworks",
  ]);

describe(
  "Etapa 48 — purity gate",
  () => {
    it(
      "domain/time não usa wall clock, scheduling ou stack técnica",
      () => {
        const files =
          fs.readdirSync(
            TIME_DIR,
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
                TIME_DIR,
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
                pattern
                  .toLowerCase(),
              ),
              `${file} contém padrão proibido: ${pattern}`,
            ).toBe(false);
          }
        }
      },
    );
  },
);
