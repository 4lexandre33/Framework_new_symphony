// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  auditDomainPortability,
} from "../scripts/architecture/lib/domain-portability-v2.mjs";

const tempRoots:
  string[] = [];

function createFixture(
  sources:
    Readonly<
      Record<
        string,
        string
      >
    >,
): string {
  const projectRoot =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "projeto1-stage66-",
      ),
    );

  tempRoots.push(
    projectRoot,
  );

  const domainRoot =
    path.join(
      projectRoot,
      "src",
      "domain",
    );

  fs.mkdirSync(
    domainRoot,
    {
      recursive: true,
    },
  );

  for (
    const [
      relativePath,
      source,
    ] of Object.entries(
      sources,
    )
  ) {
    const target =
      path.join(
        domainRoot,
        relativePath,
      );

    fs.mkdirSync(
      path.dirname(target),
      {
        recursive: true,
      },
    );

    fs.writeFileSync(
      target,
      source,
      "utf8",
    );
  }

  return projectRoot;
}

afterEach(
  () => {
    while (
      tempRoots.length > 0
    ) {
      const root =
        tempRoots.pop();

      if (
        root !== undefined
      ) {
        fs.rmSync(
          root,
          {
            recursive: true,
            force: true,
          },
        );
      }
    }
  },
);

describe(
  "Etapa 66 — auditor self-test",
  () => {
    it(
      "aceita domínio puro com imports internos",
      () => {
        const projectRoot =
          createFixture({
            "value.ts":
              "export type Value = string;\n",

            "feature.ts":
              'import type { Value } from "./value";\nexport function useValue(value: Value): Value { return value; }\n',
          });

        const result =
          auditDomainPortability({
            projectRoot,
          });

        expect(
          result.violations,
        ).toEqual([]);

        expect(result.ok)
          .toBe(true);
      },
    );

    it(
      "detecta import externo",
      () => {
        const projectRoot =
          createFixture({
            "bad.ts":
              'import { Vector3 } from "three";\nexport const value = Vector3;\n',
          });

        const result =
          auditDomainPortability({
            projectRoot,
          });

        expect(
          result.byRule.PRT001,
        ).toBeGreaterThan(0);

        expect(result.ok)
          .toBe(false);
      },
    );

    it(
      "detecta DOM, wall-clock e entropia global",
      () => {
        const projectRoot =
          createFixture({
            "bad.ts":
              [
                "export function bad(): number {",
                "  window.document;",
                "  Date.now();",
                "  return Math.random();",
                "}",
                "",
              ].join("\n"),
          });

        const result =
          auditDomainPortability({
            projectRoot,
          });

        expect(
          result.byRule.PRT002,
        ).toBeGreaterThan(0);

        expect(
          result.byRule.PRT003,
        ).toBeGreaterThan(0);

        expect(
          result.byRule.PRT004,
        ).toBeGreaterThan(0);
      },
    );

    it(
      "detecta símbolos técnicos mesmo sem import",
      () => {
        const projectRoot =
          createFixture({
            "bad.ts":
              [
                "declare const Vector3: unknown;",
                "export const value = Vector3;",
                "",
              ].join("\n"),
          });

        const result =
          auditDomainPortability({
            projectRoot,
          });

        expect(
          result.byRule.PRT005,
        ).toBeGreaterThan(0);
      },
    );

    it(
      "detecta modelo dimension-specific 2D/3D",
      () => {
        const projectRoot =
          createFixture({
            "bad.ts":
              [
                "export interface Agent3D {",
                "  readonly id: string;",
                "}",
                "",
              ].join("\n"),
          });

        const result =
          auditDomainPortability({
            projectRoot,
          });

        expect(
          result.byRule.PRT006,
        ).toBe(1);
      },
    );

    it(
      "detecta require e triple-slash refs",
      () => {
        const projectRoot =
          createFixture({
            "bad.ts":
              [
                '/// <reference types="node" />',
                'const value = require("node:fs");',
                "export { value };",
                "",
              ].join("\n"),
          });

        const result =
          auditDomainPortability({
            projectRoot,
          });

        expect(
          result.byRule.PRT007,
        ).toBeGreaterThanOrEqual(
          2,
        );
      },
    );
  },
);
