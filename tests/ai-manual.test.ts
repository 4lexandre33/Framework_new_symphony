// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
// @ts-expect-error — biblioteca .mjs sem declaração de tipos
import { checkAiManual, digestSource } from "../scripts/architecture/lib/ai-manual-v1.mjs";
// @ts-expect-error — módulo .mjs sem declaração de tipos
import { CANONICAL_MODULES } from "../scripts/architecture/module-map.mjs";

const ROOT = path.resolve(__dirname, "..");
const ts = createRequire(path.join(ROOT, "package.json"))("typescript");
const digest = digestSource as (t: unknown, f: string, s: string) => string[];

describe("manual de IA (docs/ai)", () => {
  it("está em sincronia com o código (gerado, não escrito à mão)", async () => {
    const problems = await (checkAiManual as (o: { projectRoot: string }) => Promise<string[]>)({ projectRoot: ROOT });
    expect(problems).toEqual([]);
  });

  it("cobre todos os módulos canônicos e o índice os lista", () => {
    const index = fs.readFileSync(path.join(ROOT, "docs/ai/INDEX.md"), "utf8");
    for (const mod of CANONICAL_MODULES as Array<{ key: string; capabilityId: string }>) {
      expect(fs.existsSync(path.join(ROOT, "docs/ai/modules", `${mod.key}.md`)), mod.key).toBe(true);
      expect(index).toContain(`| ${mod.key} | ${mod.capabilityId} |`);
    }
  });

  it("as receitas existem e são compiladas pelo tsc (ficam em src/)", () => {
    const dir = path.join(ROOT, "src/projects/_template/recipes");
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".ts")).length).toBeGreaterThanOrEqual(8);
    expect(fs.readFileSync(path.join(ROOT, "docs/ai/RECIPES.md"), "utf8")).toContain("01-manifest-and-lifecycle.ts");
  });

  it("RULES proíbe internals e aponta onde escrever", () => {
    const rules = fs.readFileSync(path.join(ROOT, "docs/ai/RULES.md"), "utf8");
    expect(rules).toContain("src/projects/<jogo>/");
    expect(rules).toMatch(/Nunca `src\/engine\/\*\*\/internal`/u);
  });

  it("o digest compacta eventos, comandos, capabilities e interfaces com doc de uma linha", () => {
    const lines = digest(
      ts,
      "x.ts",
      `import { defineEvent, defineCommand, defineCapability } from "@core";
       export interface A {
         /** Soma dois números. Detalhe extra. */
         add(a: number, b: number): number;
       }
       export const E = defineEvent<"game.x.e", { n: number }>("game.x.e");
       export const C = defineCommand<"game.x.c", { id: string }>("game.x.c");
       export const T = defineCapability<A>("game.x", "1.0.0");`,
    );
    const text = lines.join("\n");
    expect(text).toContain("add(a: number, b: number): number; // Soma dois números.");
    expect(text).toContain('event E = "game.x.e" payload { n: number }');
    expect(text).toContain('command C = "game.x.c" request { id: string }');
    expect(text).toContain('capability T = "game.x"@1.0.0 api A');
    expect(text).not.toContain("Detalhe extra");
  });
});
