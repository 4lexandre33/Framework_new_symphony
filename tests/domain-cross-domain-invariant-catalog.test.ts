// @vitest-environment node

import fs from "node:fs";
import path from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  CROSS_DOMAIN_INVARIANT_CATALOG_VERSION,
  CROSS_DOMAIN_INVARIANTS,
  getCrossDomainInvariantIds,
} from "../scripts/architecture/lib/domain-cross-invariants-v1.mjs";

function countMarker(
  source: string,
  id: string,
): number {
  const marker =
    `@invariant ${id}`;

  return source
    .split(marker)
    .length - 1;
}

describe(
  "Etapa 68 — invariant catalog",
  () => {
    it(
      "catálogo v1 possui 10 IDs únicos em ordem canônica",
      () => {
        expect(
          CROSS_DOMAIN_INVARIANT_CATALOG_VERSION,
        ).toBe("1.0.0");

        expect(
          getCrossDomainInvariantIds(),
        ).toEqual([
          "XINV001",
          "XINV002",
          "XINV003",
          "XINV004",
          "XINV005",
          "XINV006",
          "XINV007",
          "XINV008",
          "XINV009",
          "XINV010",
        ]);

        expect(
          new Set(
            getCrossDomainInvariantIds(),
          ).size,
        ).toBe(10);
      },
    );

    it(
      "cada invariant possui exatamente um marcador no teste declarado",
      () => {
        for (
          const invariant of
          CROSS_DOMAIN_INVARIANTS
        ) {
          const file =
            path.join(
              process.cwd(),
              ...invariant.testFile
                .split("/"),
            );

          expect(
            fs.existsSync(file),
          ).toBe(true);

          const source =
            fs.readFileSync(
              file,
              "utf8",
            );

          expect(
            countMarker(
              source,
              invariant.id,
            ),
            invariant.id,
          ).toBe(1);
        }
      },
    );
  },
);
