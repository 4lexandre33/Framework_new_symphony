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

const FILES =
  Object.freeze([
    "ResourceId.ts",
    "ResourcePool.ts",
    "CooldownId.ts",
    "Cooldown.ts",
    "CooldownSet.ts",
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
    "interactionintent",
    "affordance",
    "interactionrequirement",
    "interactionoutcome",
  ]);

describe(
  "Etapa 53 — Resources + Cooldowns purity gate",
  () => {
    it(
      "não depende de stack técnica nem Interaction futura",
      () => {
        for (
          const file of FILES
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
