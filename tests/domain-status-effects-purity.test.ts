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

const STATUS_FILES =
  Object.freeze([
    "StatusEffectId.ts",
    "StatusEffect.ts",
    "StatusEffectInstance.ts",
    "StatusEffectSet.ts",
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
    "settimeout(",
    "setinterval(",
    "modifierset",
    "modifieroperation",
  ]);

describe(
  "Etapa 51 — Status Effects purity gate",
  () => {
    it(
      "status effects não dependem de stack técnica ou Modifiers futuros",
      () => {
        for (
          const file of
          STATUS_FILES
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
