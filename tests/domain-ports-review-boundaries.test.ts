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

const PORTS_DIR =
  path.join(
    ROOT,
    "src",
    "domain",
    "ports",
  );

const REVIEWED_TS_FILES =
  Object.freeze([
    "ClockPort.ts",
    "DomainSaveGamePort.ts",
    "ModdingPort.ts",
    "SaveGamePort.ts",
    "index.ts",
  ]);

const FORBIDDEN_IMPORT_PREFIXES =
  Object.freeze([
    "src/core",
    "src/engine",
    "src/services",
    "src/app",
    "src/plugins",
    "@core",
    "three",
    "babylon",
    "rapier",
    "@tauri",
    "steamworks",
  ]);

function collectImportSpecifiers(
  source: string,
): readonly string[] {
  const imports:
    string[] = [];

  const expression =
    /\bfrom\s+["']([^"']+)["']/gu;

  let match:
    RegExpExecArray | null;

  while (
    (
      match =
        expression.exec(
          source,
        )
    ) !== null
  ) {
    const specifier =
      match[1];

    if (
      specifier !== undefined
    ) {
      imports.push(
        specifier,
      );
    }
  }

  return imports;
}

describe(
  "Etapa 65 — Ports boundary review",
  () => {
    it(
      "ports revisados não importam stack técnica ou camadas superiores",
      () => {
        for (
          const file of
          REVIEWED_TS_FILES
        ) {
          const source =
            fs.readFileSync(
              path.join(
                PORTS_DIR,
                file,
              ),
              "utf8",
            );

          for (
            const specifier of
            collectImportSpecifiers(
              source,
            )
          ) {
            const normalized =
              specifier
                .toLowerCase();

            for (
              const prefix of
              FORBIDDEN_IMPORT_PREFIXES
            ) {
              expect(
                normalized.includes(
                  prefix,
                ),
                `${file} importa dependência proibida: ${specifier}`,
              ).toBe(false);
            }
          }
        }
      },
    );

    it(
      "review não cria ports especulativos para subsistemas puros",
      () => {
        const speculative =
          [
            "RandomPort.ts",
            "RngPort.ts",
            "EventBusPort.ts",
            "EventPublisherPort.ts",
            "InputPort.ts",
            "RendererPort.ts",
            "PhysicsPort.ts",
            "AudioPort.ts",
            "SnapshotPort.ts",
            "TagPort.ts",
            "QuestPort.ts",
            "InventoryPort.ts",
            "ProgressionPort.ts",
          ];

        for (
          const file of
          speculative
        ) {
          expect(
            fs.existsSync(
              path.join(
                PORTS_DIR,
                file,
              ),
            ),
            `${file} não deveria existir após o review.`,
          ).toBe(false);
        }
      },
    );
  },
);
