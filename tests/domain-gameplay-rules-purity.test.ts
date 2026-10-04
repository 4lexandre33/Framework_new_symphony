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

const MECHANICS_DIR =
  path.join(
    ROOT,
    "src",
    "domain",
    "mechanics",
  );

const STAGE_59_FILES =
  Object.freeze([
    "GameplayRuleOutcome.ts",
    "DamageRule.ts",
    "HealingRule.ts",
    "MovementRule.ts",
    "TraversalRule.ts",
    "RequirementRule.ts",
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
    "math.random",
    "date.now",
    "performance.now",
    "requestanimationframe",
    "vector2",
    "vector3",
    "object3d",
    "sprite",
    "mesh",
    "definitionref",
    "definitionset",
    "gamedefinitions",
    "domaintag",
    "tagset",
  ]);

describe(
  "Etapa 59 — Gameplay Rules purity gate",
  () => {
    it(
      "arquivos novos não dependem de stack técnica nem etapas 60/61",
      () => {
        for (
          const file of
          STAGE_59_FILES
        ) {
          const source =
            fs.readFileSync(
              path.join(
                MECHANICS_DIR,
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
