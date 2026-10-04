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

const NARRATIVE_DIR =
  path.join(
    ROOT,
    "src",
    "domain",
    "narrative",
  );

const STAGE_58_FILES =
  Object.freeze([
    "QuestId.ts",
    "QuestDefinition.ts",
    "QuestState.ts",
    "NarrativeState.ts",
    "StoryFlagSet.ts",
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
    "vector2",
    "vector3",
    "object3d",
    "sprite",
    "mesh",
    "damagerule",
    "healingrule",
    "requirementrule",
    "traversalrule",
    "movementrule",
  ]);

describe(
  "Etapa 58 — Narrative purity gate",
  () => {
    it(
      "arquivos novos não dependem de stack técnica nem Gameplay Rules futuros",
      () => {
        for (
          const file of
          STAGE_58_FILES
        ) {
          const source =
            fs.readFileSync(
              path.join(
                NARRATIVE_DIR,
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
