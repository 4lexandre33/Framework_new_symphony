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

const ECONOMY_DIR =
  path.join(
    ROOT,
    "src",
    "domain",
    "economy",
  );

const STAGE_56_FILES =
  Object.freeze([
    "CurrencyId.ts",
    "CurrencyAccount.ts",
    "Cost.ts",
    "Reward.ts",
    "RewardPolicy.ts",
    "LootEntry.ts",
    "LootTable.ts",
    "CraftingRecipe.ts",
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
    "progressioncurve",
    "experiencepool",
    "levelprogression",
    "unlockset",
    "progressionsnapshot",
  ]);

describe(
  "Etapa 56 — Economy purity gate",
  () => {
    it(
      "arquivos novos não dependem de stack técnica, RNG global ou Progression futura",
      () => {
        for (
          const file of
          STAGE_56_FILES
        ) {
          const source =
            fs.readFileSync(
              path.join(
                ECONOMY_DIR,
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
