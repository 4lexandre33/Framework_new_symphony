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

const DOCUMENTS =
  Object.freeze([
    "README.md",
    "architecture.md",
    "domain-reference.md",
    "integration-contracts.md",
    "state-persistence-determinism.md",
    "performance-portability.md",
    "extension-guide.md",
    "stage-history.md",
  ]);

describe(
  "Etapa 69 — Layer 2 documentation",
  () => {
    it(
      "mantém o conjunto documental completo",
      () => {
        const docsRoot =
          path.join(
            ROOT,
            "docs",
            "layer2",
          );

        const actual =
          fs.readdirSync(
            docsRoot,
          )
            .filter(
              (name) =>
                name.endsWith(
                  ".md",
                ),
            )
            .sort();

        expect(actual).toEqual(
          [...DOCUMENTS]
            .sort(),
        );
      },
    );

    it(
      "documenta todos os roots atuais de src/domain",
      () => {
        const domainRoots =
          fs.readdirSync(
            path.join(
              ROOT,
              "src",
              "domain",
            ),
            {
              withFileTypes:
                true,
            },
          )
            .filter(
              (entry) =>
                entry
                  .isDirectory(),
            )
            .map(
              (entry) =>
                entry.name,
            )
            .sort();

        const reference =
          fs.readFileSync(
            path.join(
              ROOT,
              "docs",
              "layer2",
              "domain-reference.md",
            ),
            "utf8",
          );

        for (
          const rootName of
          domainRoots
        ) {
          expect(
            reference.includes(
              `src/domain/${rootName}`,
            ),
            rootName,
          ).toBe(true);
        }
      },
    );

    it(
      "documenta Stage 66, 67 e 68 como gates executáveis",
      () => {
        const portability =
          fs.readFileSync(
            path.join(
              ROOT,
              "docs/layer2/performance-portability.md",
            ),
            "utf8",
          );

        const integration =
          fs.readFileSync(
            path.join(
              ROOT,
              "docs/layer2/integration-contracts.md",
            ),
            "utf8",
          );

        for (
          let index = 1;
          index <= 8;
          index += 1
        ) {
          expect(
            portability.includes(
              `PRT${String(index).padStart(3, "0")}`,
            ),
          ).toBe(true);
        }

        for (
          let index = 1;
          index <= 7;
          index += 1
        ) {
          expect(
            portability.includes(
              `PERF${String(index).padStart(3, "0")}`,
            ),
          ).toBe(true);
        }

        for (
          let index = 1;
          index <= 10;
          index += 1
        ) {
          expect(
            integration.includes(
              `XINV${String(index).padStart(3, "0")}`,
            ),
          ).toBe(true);
        }
      },
    );

    it(
      "documentação não declara Stage 70 como concluída",
      () => {
        for (
          const document of
          DOCUMENTS
        ) {
          const source =
            fs.readFileSync(
              path.join(
                ROOT,
                "docs",
                "layer2",
                document,
              ),
              "utf8",
            )
              .toLowerCase();

          expect(
            source.includes(
              "stage 70: pass",
            ),
            document,
          ).toBe(false);

          expect(
            source.includes(
              "etapa 70: pass",
            ),
            document,
          ).toBe(false);
        }
      },
    );
  },
);
