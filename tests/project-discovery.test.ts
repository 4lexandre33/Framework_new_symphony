// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createProjectPlugins, listProjects, resolveProjectSelection } from "../src/project";
import type { ProjectDefinition } from "../src/project-contract";

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

  it("a engine não referencia projetos consumidores nem usa vocabulário de jogo", () => {
    for (const dir of ["src/core", "src/engine", "src/plugins", "src/contracts", "src/tokens"]) {
      const stack = [path.join(ROOT, dir)];
      while (stack.length > 0) {
        const current = stack.pop() as string;
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          const full = path.join(current, entry.name);
          if (entry.isDirectory()) stack.push(full);
          else if (entry.name.endsWith(".ts")) {
            const text = fs.readFileSync(full, "utf8");
            expect(text, full).not.toMatch(/from\s+["'][^"']*\/projects\//u);
            // vocabulário de jogo não pertence à engine
            expect(text, full).not.toMatch(/PlayerHUDData|BossDefeated|game\.boss-defeated|game\.player|dragon_boss/u);
          }
        }
      }
    }
  });

  describe("G24: vários projetos sem VITE_PROJECT não derrubam o app", () => {
    const fake = (id: string): ProjectDefinition => ({ id, name: id.toUpperCase(), createPlugins: () => [] });
    const two = [fake("a"), fake("b")];

    it("sem seleção: none/ambiguous (não lança) com a lista disponível", () => {
      const sel = resolveProjectSelection(two, {});
      expect(sel).toMatchObject({ status: "none", reason: "ambiguous" });
      expect(sel.status === "none" && sel.available.map((p) => p.id)).toEqual(["a", "b"]);
    });

    it("precedência argumento > VITE_PROJECT > ?project= > único", () => {
      expect(resolveProjectSelection(two, { requested: "b", env: "a", search: "?project=a" })).toMatchObject({ status: "selected", source: "argument", project: { id: "b" } });
      expect(resolveProjectSelection(two, { env: "a", search: "?project=b" })).toMatchObject({ status: "selected", source: "env", project: { id: "a" } });
      expect(resolveProjectSelection(two, { search: "?project=b" })).toMatchObject({ status: "selected", source: "url", project: { id: "b" } });
      expect(resolveProjectSelection([fake("x")], {})).toMatchObject({ status: "selected", source: "single" });
      expect(resolveProjectSelection([], {})).toMatchObject({ status: "none", reason: "no-projects" });
    });

    it("?project= inexistente não lança; id explícito inexistente continua erro claro", () => {
      expect(resolveProjectSelection(two, { search: "?project=zzz" })).toMatchObject({ status: "none", reason: "unknown-url", requested: "zzz" });
      expect(() => resolveProjectSelection(two, { env: "zzz" })).toThrow(/não encontrado/u);
      expect(resolveProjectSelection(two, { env: "none" })).toMatchObject({ status: "none", reason: "explicit-none" });
    });
  });
});
