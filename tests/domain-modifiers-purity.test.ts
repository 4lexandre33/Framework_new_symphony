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

const MODIFIER_FILES =
  Object.freeze([
    "ModifierId.ts",
    "ModifierOperation.ts",
    "Modifier.ts",
    "ModifierSet.ts",
  ]);

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
    "resourcepool",
    "cooldownset",
    "cooldown.ts",
  ]);

describe(
  "Etapa 52 — Modifiers purity gate",
  () => {
    it(
      "modifier system não depende de stack técnica nem Etapa 53",
      () => {
        for (
          const file of
          MODIFIER_FILES
        ) {
          const source =
            fs.readFileSync(
              path.join(
                ROOT,
                "src",
                "domain",
                "mechanics",
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
