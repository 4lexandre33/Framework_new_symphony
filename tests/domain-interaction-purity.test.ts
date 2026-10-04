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

const INTERACTION_DIR =
  path.join(
    ROOT,
    "src",
    "domain",
    "interaction",
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
    "conditionevaluator",
    "inventory",
    "dialoguegraph",
    "statestore",
    "domainevent",
    "three",
    "babylon",
    "rapier",
    "@tauri",
    "steamworks",
    "raycast",
    "collider",
    "rigidbody",
    "vector2",
    "vector3",
    "object3d",
    "sprite",
    "mesh",
    "requestanimationframe",
    "performance.now",
    "date.now",
  ]);

describe(
  "Etapa 54 — Interaction purity gate",
  () => {
    it(
      "domain/interaction não depende de detecção física nem integrações futuras",
      () => {
        const files =
          fs.readdirSync(
            INTERACTION_DIR,
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
                INTERACTION_DIR,
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
