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

const EVENTS_DIR =
  path.join(
    ROOT,
    "src",
    "domain",
    "events",
  );

const FORBIDDEN_PATTERNS =
  Object.freeze([
    "from \"@core",
    "from '@core",
    "src/core",
    "src/engine",
    "src/services",
    "src/app",
    "src/plugins",
    "addeventlistener",
    "dispatchevent",
    "eventtarget",
    "@tauri",
    "steamworks",
    "three",
    "babylon",
    "rapier",
  ]);

describe(
  "Etapa 49 — Domain Events purity gate",
  () => {
    it(
      "domain/events não depende de EventBus/Core/infraestrutura",
      () => {
        const files =
          fs.readdirSync(
            EVENTS_DIR,
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
                EVENTS_DIR,
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
