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

const INTEGRATION_DIR =
  path.join(
    ROOT,
    "src",
    "domain",
    "integration",
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
    "domainsnapshotregistry",
    "snapshotbundle",
    "snapshotcoordinator",
  ]);

describe(
  "Etapa 62 — Cross-domain integration purity gate",
  () => {
    it(
      "integration usa apenas domínio e não antecipa infraestrutura/Etapa 63",
      () => {
        const sourceFiles =
          fs.readdirSync(
            INTEGRATION_DIR,
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
                INTEGRATION_DIR,
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
