// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createProjectPlugins, listProjects } from "../src/project";

const ROOT = path.resolve(__dirname, "..");

describe("descoberta de projetos consumidores", () => {
  it("project.ts não importa nenhum jogo pelo nome", () => {
    const source = fs.readFileSync(path.join(ROOT, "src", "project.ts"), "utf8");
    expect(source).not.toMatch(/from\s+["']\.\/projects\//u);
    expect(source).toContain("import.meta.glob");
  });

  it("ids são únicos e o molde _template não é carregado", () => {
    const ids = listProjects().map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain("meu-jogo");
  });

  it('"none" sobe sem projeto e um id inexistente é erro claro', () => {
    expect(createProjectPlugins("none")).toEqual([]);
    if (listProjects().length > 0) {
      expect(() => createProjectPlugins("nao-existe")).toThrow(/não encontrado/u);
    }
  });

  it("a engine não referencia projetos consumidores", () => {
    for (const dir of ["src/core", "src/engine", "src/plugins", "src/contracts", "src/tokens"]) {
      const stack = [path.join(ROOT, dir)];
      while (stack.length > 0) {
        const current = stack.pop() as string;
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          const full = path.join(current, entry.name);
          if (entry.isDirectory()) stack.push(full);
          else if (entry.name.endsWith(".ts")) {
            expect(fs.readFileSync(full, "utf8"), full).not.toMatch(/from\s+["'][^"']*\/projects\//u);
          }
        }
      }
    }
  });
});
