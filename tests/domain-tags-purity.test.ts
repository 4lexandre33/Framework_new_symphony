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

const TAGS_DIR =
  path.join(
    ROOT,
    "src",
    "domain",
    "tags",
  );

const FORBIDDEN_PATTERNS =
  Object.freeze([
    "src/core",
    "src/engine",
    "src/services",
    "src/app",
    "src/plugins",
    "src/domain/definitions",
    "src/domain/economy",
    "src/domain/narrative",
    "src/domain/mechanics",
    "src/domain/relations",
    "src/domain/events",
    "src/domain/state",
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
  ]);

describe(
  "Etapa 61 — Tags purity gate",
  () => {
    it(
      "domain/tags é autônomo e não antecipa integração cross-domain",
      () => {
        const sourceFiles =
          fs.readdirSync(
            TAGS_DIR,
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
          "DomainTag.ts",
          "TagSet.ts",
          "index.ts",
        ]);

        for (
          const file of
          sourceFiles
        ) {
          const source =
            fs.readFileSync(
              path.join(
                TAGS_DIR,
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
