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
  auditDomainPerformance,
} from "../scripts/architecture/lib/domain-performance-v1.mjs";

const tempRoots:
  string[] = [];

function createFixture(
  source: string,
): string {
  const projectRoot =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "projeto1-stage67-",
      ),
    );

  tempRoots.push(
    projectRoot,
  );

  const target =
    path.join(
      projectRoot,
      "src/domain/demo/Demo.ts",
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

  return projectRoot;
}

const HOT_POLICY = [
  {
    file:
      "src/domain/demo/Demo.ts",
    className:
      "Demo",
    methods: [
      "tick",
    ],
    maxLoopDepth: 1,
  },
] as const;

const LIFECYCLE_POLICY = [
  {
    file:
      "src/domain/demo/Demo.ts",
    className:
      "Demo",
    requiredMethods: [
      "clear",
    ],
  },
] as const;

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
  "Etapa 67 — performance auditor self-test",
  () => {
    it(
      "aceita hot path escalar sem allocation/materialization",
      () => {
        const projectRoot =
          createFixture(
            [
              "export class Demo {",
              "  private value = 0;",
              "  public tick(input: number): number {",
              "    this.value += input;",
              "    return this.value;",
              "  }",
              "  public clear(): void { this.value = 0; }",
              "}",
              "",
            ].join("\n"),
          );

        const result =
          auditDomainPerformance({
            projectRoot,
            hotPaths:
              HOT_POLICY,
            lifecyclePolicies:
              LIFECYCLE_POLICY,
          });

        expect(
          result.violations,
        ).toEqual([]);
      },
    );

    it(
      "detecta alocação normal em hot path",
      () => {
        const projectRoot =
          createFixture(
            [
              "export class Demo {",
              "  public tick(input: number): number {",
              "    const values = [input];",
              "    return values[0] ?? 0;",
              "  }",
              "  public clear(): void {}",
              "}",
              "",
            ].join("\n"),
          );

        const result =
          auditDomainPerformance({
            projectRoot,
            hotPaths:
              HOT_POLICY,
            lifecyclePolicies:
              LIFECYCLE_POLICY,
          });

        expect(
          result.byRule.PERF002,
        ).toBeGreaterThan(0);
      },
    );

    it(
      "detecta map/sort/snapshot materialization em hot path",
      () => {
        const projectRoot =
          createFixture(
            [
              "export class Demo {",
              "  private values = [1, 2, 3];",
              "  public tick(): number {",
              "    return this.values.map((value) => value + 1).sort()[0] ?? 0;",
              "  }",
              "  public clear(): void { this.values.length = 0; }",
              "}",
              "",
            ].join("\n"),
          );

        const result =
          auditDomainPerformance({
            projectRoot,
            hotPaths:
              HOT_POLICY,
            lifecyclePolicies:
              LIFECYCLE_POLICY,
          });

        expect(
          result.byRule.PERF003,
        ).toBeGreaterThanOrEqual(
          2,
        );

        expect(
          result.byRule.PERF002,
        ).toBeGreaterThan(0);
      },
    );

    it(
      "detecta loop aninhado acima do budget",
      () => {
        const projectRoot =
          createFixture(
            [
              "export class Demo {",
              "  public tick(): number {",
              "    let total = 0;",
              "    for (let a = 0; a < 2; a += 1) {",
              "      for (let b = 0; b < 2; b += 1) {",
              "        total += a + b;",
              "      }",
              "    }",
              "    return total;",
              "  }",
              "  public clear(): void {}",
              "}",
              "",
            ].join("\n"),
          );

        const result =
          auditDomainPerformance({
            projectRoot,
            hotPaths:
              HOT_POLICY,
            lifecyclePolicies:
              LIFECYCLE_POLICY,
          });

        expect(
          result.byRule.PERF004,
        ).toBe(1);
      },
    );

    it(
      "detecta async/await em hot path",
      () => {
        const projectRoot =
          createFixture(
            [
              "export class Demo {",
              "  public async tick(): Promise<number> {",
              "    await Promise.resolve();",
              "    return 1;",
              "  }",
              "  public clear(): void {}",
              "}",
              "",
            ].join("\n"),
          );

        const result =
          auditDomainPerformance({
            projectRoot,
            hotPaths:
              HOT_POLICY,
            lifecyclePolicies:
              LIFECYCLE_POLICY,
          });

        expect(
          result.byRule.PERF005,
        ).toBeGreaterThanOrEqual(
          1,
        );
      },
    );

    it(
      "detecta lifecycle release ausente",
      () => {
        const projectRoot =
          createFixture(
            [
              "export class Demo {",
              "  public tick(): number { return 1; }",
              "}",
              "",
            ].join("\n"),
          );

        const result =
          auditDomainPerformance({
            projectRoot,
            hotPaths:
              HOT_POLICY,
            lifecyclePolicies:
              LIFECYCLE_POLICY,
          });

        expect(
          result.byRule.PERF006,
        ).toBe(1);
      },
    );

    it(
      "ignora alocação exclusivamente em throw path",
      () => {
        const projectRoot =
          createFixture(
            [
              "export class Demo {",
              "  public tick(input: number): number {",
              "    if (input < 0) {",
              '      throw new Error("negative");',
              "    }",
              "    return input + 1;",
              "  }",
              "  public clear(): void {}",
              "}",
              "",
            ].join("\n"),
          );

        const result =
          auditDomainPerformance({
            projectRoot,
            hotPaths:
              HOT_POLICY,
            lifecyclePolicies:
              LIFECYCLE_POLICY,
          });

        expect(
          result.byRule.PERF002,
        ).toBe(0);

        expect(result.ok)
          .toBe(true);
      },
    );
  },
);
