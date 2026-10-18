/**
 * T2 — domínio knowledge, resources engine://… e prompts, contra os docs reais do repo.
 */

import { readdirSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseGaps, parseIndex, parseModuleDoc, splitRow } from "../../tools/mcp/src/knowledge/docs.ts";
import { parseTokenSource } from "../../tools/mcp/src/knowledge/token-api.ts";
import { createTestClient, makeTempRepo, REPO_ROOT, textOf, type TestClient } from "./harness.ts";

const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const moduleKeys = readdirSync(path.join(REPO_ROOT, "docs/ai/modules"))
  .filter((f) => f.endsWith(".md"))
  .map((f) => f.slice(0, -3))
  .sort();
const recipeFiles = readdirSync(path.join(REPO_ROOT, "src/projects/_template/recipes"))
  .filter((f) => f.endsWith(".ts"))
  .sort();

/** Conta as linhas de dados das tabelas abertas do GAPS.md de forma independente do parser. */
function countOpenGapRows(md: string): number {
  let section = "";
  let header = false;
  let count = 0;
  for (const line of md.split(/\r?\n/)) {
    if (line.startsWith("## ")) {
      section = line;
      header = false;
      continue;
    }
    if (!line.startsWith("|")) {
      header = false;
      continue;
    }
    if (line.startsWith("| # |")) {
      header = true;
      continue;
    }
    if (/^\|\s*-/.test(line)) continue;
    if (header && !/Resolvid/i.test(section)) count++;
  }
  return count;
}

let t: TestClient;

beforeAll(async () => {
  t = await createTestClient();
});

afterAll(async () => {
  await t.close();
});

describe("registro", () => {
  it("expõe as 8 tools de conhecimento com descrições", async () => {
    const tools = await t.listTools();
    const names = tools.map((x) => x.name);
    for (const n of ["engine_info", "docs_index", "docs_read", "docs_search", "module_api", "gaps_list", "recipes_list", "recipe_read"]) {
      expect(names).toContain(n);
      const tool = tools.find((x) => x.name === n)!;
      expect(tool.description!.length).toBeGreaterThan(20);
      expect(tool.annotations?.readOnlyHint).toBe(true);
    }
  });
});

describe("engine_info", () => {
  it("devolve versão, git, módulos, jogos e freeze-lock", async () => {
    const pkg = JSON.parse(read("package.json")) as { version: string };
    const out = await t.callTool("engine_info");
    expect(out.engineVersion).toBe(pkg.version);
    expect(out.modules.source).toBe("module-map");
    expect(out.modules.count).toBe(moduleKeys.length);
    expect(out.modules.capabilities.map((c: { key: string }) => c.key).sort()).toEqual(moduleKeys);
    expect(out.modules.capabilities.find((c: { key: string }) => c.key === "physics").capabilityId).toBe("game.physics");
    expect(out.modules.functional + out.modules.runtime).toBe(out.modules.count);
    const ids = out.projects.map((p: { id: string }) => p.id);
    expect(ids).toContain("physics-sandbox");
    expect(ids.some((id: string) => id.startsWith("_"))).toBe(false);
    expect(["locked", "drift", "unlocked", "invalid"]).toContain(out.freezeLock.status);
    if (out.freezeLock.present) expect(out.freezeLock.files).toBeGreaterThan(0);
    // git pode faltar (cópia sem .git); quando existe o commit é um sha
    if (out.git.commit !== null) expect(out.git.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it("funciona sem module-map, sem freeze-lock e sem git (repo temporário)", async () => {
    const repo = await makeTempRepo();
    const t2 = await createTestClient({ root: repo.root });
    try {
      const out = await t2.callTool("engine_info");
      expect(out.engineVersion).toBe("0.0.0-test");
      expect(out.modules.source).toBe("docs");
      expect(out.modules.count).toBe(moduleKeys.length);
      expect(out.freezeLock.status).toBe("unlocked");
      expect(out.projects).toEqual([]);
    } finally {
      await t2.close();
      await repo.cleanup();
    }
  });

  it("detecta drift do freeze-lock", async () => {
    const repo = await makeTempRepo();
    await writeFile(path.join(repo.root, "a.txt"), "x");
    await writeFile(
      path.join(repo.root, ".freeze-lock.json"),
      JSON.stringify({ version: "1", lockedAt: "agora", files: { "a.txt": "0".repeat(64), "sumiu.txt": "0".repeat(64) } }),
    );
    const t2 = await createTestClient({ root: repo.root });
    try {
      const out = await t2.callTool("engine_info");
      expect(out.freezeLock).toMatchObject({ status: "drift", present: true, files: 2, changed: ["a.txt"], missing: ["sumiu.txt"] });
    } finally {
      await t2.close();
      await repo.cleanup();
    }
  });

  it("recusa argumentos desconhecidos", async () => {
    await expect(t.callTool("engine_info", { x: 1 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("docs_index", () => {
  it("estrutura a tabela de módulos do INDEX.md", async () => {
    const out = await t.callTool("docs_index");
    expect(out.modules.map((m: { key: string }) => m.key).sort()).toEqual(moduleKeys);
    const camera = out.modules.find((m: { key: string }) => m.key === "camera");
    expect(camera).toMatchObject({ capability: "game.camera", docPath: "docs/ai/modules/camera.md" });
    expect(camera.dependsOn).toEqual(["game.loop", "game.physics", "game.render"]);
    expect(camera.tokens).toBeGreaterThan(0);
    expect(out.readingOrder.length).toBeGreaterThanOrEqual(5);
    expect(out.sizes.RULES).toBeGreaterThan(0);
    expect(out.sizes.modules).toBeGreaterThan(0);
    expect(out.docs).toEqual(["RULES", "CORE", "RECIPES", "GAPS", "INDEX"]);
  });

  it("NOT_FOUND quando o INDEX.md não existe", async () => {
    const repo = await makeTempRepo();
    await rm(path.join(repo.root, "docs/ai/INDEX.md"));
    const t2 = await createTestClient({ root: repo.root });
    try {
      await expect(t2.callTool("docs_index")).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally {
      await t2.close();
      await repo.cleanup();
    }
  });
});

describe("docs_read", () => {
  it("lê doc, module, note e path", async () => {
    const rules = await t.callTool("docs_read", { doc: "RULES" });
    expect(rules).toMatchObject({ kind: "doc", name: "RULES", path: "docs/ai/RULES.md" });
    expect(rules.content).toBe(read("docs/ai/RULES.md"));

    const mod = await t.callTool("docs_read", { module: "physics" });
    expect(mod.path).toBe("docs/ai/modules/physics.md");
    expect(mod.content).toContain("game.physics");

    const note = await t.callTool("docs_read", { note: "world" });
    expect(note.content).toBe(read("docs/ai/notes/world.md"));

    const layer1 = await t.callTool("docs_read", { path: "docs/layer1/creating-a-game.md" });
    expect(layer1.kind).toBe("path");
    expect(layer1.bytes).toBe(Buffer.byteLength(read("docs/layer1/creating-a-game.md")));
  });

  it("módulo desconhecido: NOT_FOUND com a lista válida na dica", async () => {
    const err = await t.callTool("docs_read", { module: "fisica" }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "NOT_FOUND" });
    expect((err as { hint: string }).hint).toContain("physics");
    expect((err as { hint: string }).hint).toContain("game-loop");
  });

  it("nota desconhecida, doc inválido, nenhum/vários argumentos, path fora do manual", async () => {
    await expect(t.callTool("docs_read", { note: "nada" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(t.callTool("docs_read", { doc: "README" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const none = await t.callTool("docs_read", {}).catch((e: unknown) => e);
    expect(none).toMatchObject({ code: "INVALID_INPUT" });
    expect((none as { hint: string }).hint).toContain("RULES");
    await expect(t.callTool("docs_read", { doc: "RULES", module: "physics" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(t.callTool("docs_read", { path: "package.json" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(t.callTool("docs_read", { path: "../../etc/passwd" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("docs_search", () => {
  it("acha símbolos com caminho:linha e trecho", async () => {
    const out = await t.callTool("docs_search", { query: "setNextKinematicTransform", limit: 50 });
    expect(out.total).toBeGreaterThan(0);
    expect(out.filesSearched).toBeGreaterThan(40);
    const first = out.results[0];
    expect(first.location).toBe(`${first.path}:${first.line}`);
    const line = read(first.path).split(/\r?\n/)[first.line - 1]!;
    expect(line.toLowerCase()).toContain("setnextkinematictransform");
    expect(first.snippet.length).toBeLessThanOrEqual(242);
    const roots = new Set<string>(out.results.map((r: { path: string }) => r.path.split("/").slice(0, 2).join("/")));
    expect([...roots].every((r) => ["docs/ai", "docs/layer1", "docs/mcp", "src/projects"].includes(r))).toBe(true);
  });

  it("ignora maiúsculas e acentos e busca nas receitas", async () => {
    const a = await t.callTool("docs_search", { query: "LACUNAS", limit: 200 });
    const b = await t.callTool("docs_search", { query: "lacunas", limit: 200 });
    expect(a.total).toBe(b.total);
    const accent = await t.callTool("docs_search", { query: "notas verificadas comportamento", limit: 200 });
    expect(accent.total).toBeGreaterThanOrEqual(moduleKeys.length);
    const noAccent = await t.callTool("docs_search", { query: "modulo", limit: 5 });
    const withAccent = await t.callTool("docs_search", { query: "MÓDULO", limit: 5 });
    expect(noAccent.total).toBeGreaterThan(0);
    expect(noAccent.total).toBe(withAccent.total);
    const recipe = await t.callTool("docs_search", { query: "spawnCrate", limit: 50 });
    expect(recipe.results.some((r: { path: string }) => r.path.startsWith("src/projects/_template/recipes/"))).toBe(true);
  });

  it("respeita o limite e indica truncamento", async () => {
    const out = await t.callTool("docs_search", { query: "game", limit: 3 });
    expect(out.results).toHaveLength(3);
    expect(out.truncated).toBe(true);
    expect(out.total).toBeGreaterThan(3);
  });

  it("sem resultados e entrada inválida", async () => {
    const out = await t.callTool("docs_search", { query: "zzqqxxnaoexiste" });
    expect(out).toMatchObject({ total: 0, truncated: false, results: [] });
    await expect(t.callTool("docs_search", { query: "a" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(t.callTool("docs_search", { query: "game", limit: 0 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("module_api", () => {
  it("game-loop: métodos com assinatura e JSDoc, eventos e comandos", async () => {
    const out = await t.callTool("module_api", { module: "game-loop" });
    expect(out).toMatchObject({ key: "game-loop", capability: "game.loop@1.0.0", category: "runtime", pluginId: "game.loop" });
    const token = out.tokens[0];
    expect(token.path).toBe("src/tokens/game-loop.ts");
    expect(token.capabilities).toEqual([{ constName: "GameLoopToken", api: "GameLoopApi", id: "game.loop", version: "1.0.0" }]);
    const api = token.interfaces.find((i: { name: string }) => i.name === "GameLoopApi");
    const pause = api.members.find((m: { name: string }) => m.name === "pause");
    expect(pause).toMatchObject({ kind: "method", signature: "pause(options?: PauseOptions): void" });
    expect(pause.doc).toContain("Congela a simulação");
    expect(api.members.find((m: { name: string }) => m.name === "setTickRate").signature).toBe("setTickRate(ticksPerSecond: number): boolean");
    const stats = token.interfaces.find((i: { name: string }) => i.name === "GameLoopStats");
    expect(stats.members.find((m: { name: string }) => m.name === "fps")).toMatchObject({ kind: "property", readonly: true });
    expect(out.events.map((e: { type: string }) => e.type)).toEqual(expect.arrayContaining(["game.loop.tick", "game.loop.render"]));
    expect(out.commands.find((c: { type: string }) => c.type === "game.loop.resume").request).toBe("Record<string, never>");
    expect(out.contracts).toContain("src/contracts/game-loop/types.ts");
    expect(out.notes.length).toBeGreaterThan(3);
  });

  it("steam: token secundário e eventos com descrição", async () => {
    const out = await t.callTool("module_api", { module: "steam" });
    expect(out.tokens.map((x: { path: string }) => x.path)).toEqual(["src/tokens/steam.ts", "src/tokens/steam-net.ts"]);
    expect(out.tokens[1]).toMatchObject({ capabilityId: "game.steam.net", primary: false });
    expect(out.events.length + out.commands.length).toBe((read("docs/ai/modules/steam.md").match(/^(event|command) /gm) ?? []).length);
  });

  it("inclui as lacunas abertas do módulo", async () => {
    const net = await t.callTool("module_api", { module: "net" });
    expect(net.gaps.map((g: { id: string }) => g.id)).toContain("G8");
    expect(net.gaps.every((g: { section: string }) => g.section === "net")).toBe(true);
    const world = await t.callTool("module_api", { module: "world" });
    expect(world.gaps).toEqual([]);
  });

  it("todos os módulos do manual são analisáveis", async () => {
    for (const key of moduleKeys) {
      const out = await t.callTool("module_api", { module: key });
      expect(out.tokens.length, key).toBeGreaterThan(0);
      const methods = out.tokens.flatMap((x: { interfaces: Array<{ members: Array<{ kind: string }> }> }) =>
        x.interfaces.flatMap((i) => i.members.filter((m) => m.kind === "method")),
      );
      expect(methods.length, key).toBeGreaterThan(0);
    }
  });

  it("módulo desconhecido: NOT_FOUND com lista", async () => {
    const err = await t.callTool("module_api", { module: "../tokens/x" }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "NOT_FOUND" });
    expect((err as { hint: string }).hint).toContain("world");
    await expect(t.callTool("module_api", {})).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("gaps_list", () => {
  it("bate com as linhas abertas do GAPS.md", async () => {
    const md = read("docs/ai/GAPS.md");
    const out = await t.callTool("gaps_list");
    expect(out.total).toBe(countOpenGapRows(md));
    expect(out.gaps.length).toBe(out.total);
    for (const g of out.gaps) {
      expect(md.split(/\r?\n/)[g.line - 1]).toContain(g.problem.slice(0, 30));
      expect(["A", "M", "B"]).toContain(g.severity);
      expect(["LACUNA", "RISCO", "DESIGN", "NV"]).toContain(g.type);
      expect(g.section).not.toMatch(/Resolvid/i);
    }
    expect(out.sections).toContain("Transversais");
  });

  it("filtra por módulo, gravidade e tipo", async () => {
    const net = await t.callTool("gaps_list", { module: "net" });
    expect(net.gaps.length).toBeGreaterThan(0);
    expect(net.gaps.every((g: { section: string }) => g.section === "net")).toBe(true);
    const withCross = await t.callTool("gaps_list", { module: "net", includeCrossCutting: true });
    expect(withCross.total).toBeGreaterThan(net.total);
    const severe = await t.callTool("gaps_list", { severity: "M" });
    expect(severe.gaps.every((g: { severity: string }) => g.severity === "M")).toBe(true);
    const design = await t.callTool("gaps_list", { type: "DESIGN" });
    expect(design.gaps.every((g: { type: string }) => g.type === "DESIGN")).toBe(true);
    const world = await t.callTool("gaps_list", { module: "world" });
    expect(world.total).toBe(0);
  });

  it("erros: módulo desconhecido e gravidade inválida", async () => {
    await expect(t.callTool("gaps_list", { module: "nada" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(t.callTool("gaps_list", { severity: "X" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("recipes", () => {
  it("recipes_list lista todas as receitas com descrição", async () => {
    const out = await t.callTool("recipes_list");
    expect(out.recipes.map((r: { name: string }) => `${r.name}.ts`)).toEqual(recipeFiles);
    const physics = out.recipes.find((r: { name: string }) => r.name === "03-physics-body");
    expect(physics.description).toContain("Corpo rígido");
    expect(physics.imports).toContain("../../../tokens/physics");
  });

  it("recipe_read aceita nome, .ts, número e nome sem prefixo", async () => {
    const full = await t.callTool("recipe_read", { name: "03-physics-body" });
    expect(full.content).toBe(read("src/projects/_template/recipes/03-physics-body.ts"));
    expect((await t.callTool("recipe_read", { name: "03-physics-body.ts" })).name).toBe("03-physics-body");
    expect((await t.callTool("recipe_read", { name: "3" })).name).toBe("03-physics-body");
    expect((await t.callTool("recipe_read", { name: "physics-body" })).name).toBe("03-physics-body");
  });

  it("recipe_read: NOT_FOUND com a lista", async () => {
    const err = await t.callTool("recipe_read", { name: "99" }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "NOT_FOUND" });
    expect((err as { hint: string }).hint).toContain("01-manifest-and-lifecycle");
    await expect(t.callTool("recipe_read", { name: "" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("resources", () => {
  it("lista docs, módulos e receitas", async () => {
    const { resources } = await t.client.listResources();
    const uris = resources.map((r) => r.uri);
    for (const d of ["RULES", "CORE", "RECIPES", "GAPS", "INDEX"]) expect(uris).toContain(`engine://docs/${d}`);
    for (const k of moduleKeys) expect(uris).toContain(`engine://module/${k}`);
    expect(uris).toContain("engine://recipe/03-physics-body");
    const { resourceTemplates } = await t.client.listResourceTemplates();
    expect(resourceTemplates.map((r) => r.uriTemplate)).toEqual(
      expect.arrayContaining(["engine://docs/{name}", "engine://module/{key}", "engine://recipe/{name}", "engine://project/{id}/report"]),
    );
  });

  it("lê docs, módulo e receita", async () => {
    const rules = await t.client.readResource({ uri: "engine://docs/RULES" });
    expect((rules.contents[0] as { text: string }).text).toBe(read("docs/ai/RULES.md"));
    expect(rules.contents[0]!.mimeType).toBe("text/markdown");
    const mod = await t.client.readResource({ uri: "engine://module/world" });
    expect((mod.contents[0] as { text: string }).text).toBe(read("docs/ai/modules/world.md"));
    const recipe = await t.client.readResource({ uri: "engine://recipe/02-tick-loop" });
    expect((recipe.contents[0] as { text: string }).text).toBe(read("src/projects/_template/recipes/02-tick-loop.ts"));
  });

  it("erros de resource: nome/módulo/jogo desconhecidos", async () => {
    await expect(t.client.readResource({ uri: "engine://docs/README" })).rejects.toThrow(/NOT_FOUND/);
    await expect(t.client.readResource({ uri: "engine://module/nada" })).rejects.toThrow(/NOT_FOUND/);
    await expect(t.client.readResource({ uri: "engine://project/nao-existe/report" })).rejects.toThrow(/NOT_FOUND/);
    await expect(t.client.readResource({ uri: "engine://project/Ruim_ID/report" })).rejects.toThrow(/INVALID_INPUT/);
  });

  it("ENGINE_REPORT de um jogo (repo temporário)", async () => {
    const repo = await makeTempRepo();
    await mkdir(path.join(repo.root, "src/projects/jogo-a"), { recursive: true });
    await mkdir(path.join(repo.root, "src/projects/jogo-b"), { recursive: true });
    await writeFile(path.join(repo.root, "src/projects/jogo-a/ENGINE_REPORT.md"), "# relatório\n- ok\n");
    const t2 = await createTestClient({ root: repo.root });
    try {
      const { resources } = await t2.client.listResources();
      const uris = resources.map((r) => r.uri);
      expect(uris).toContain("engine://project/jogo-a/report");
      expect(uris).not.toContain("engine://project/jogo-b/report");
      const res = await t2.client.readResource({ uri: "engine://project/jogo-a/report" });
      expect((res.contents[0] as { text: string }).text).toBe("# relatório\n- ok\n");
      await expect(t2.client.readResource({ uri: "engine://project/jogo-b/report" })).rejects.toThrow(/NOT_FOUND/);
      const c = await t2.client.complete({ ref: { type: "ref/resource", uri: "engine://project/{id}/report" }, argument: { name: "id", value: "jo" } });
      expect(c.completion.values.sort()).toEqual(["jogo-a", "jogo-b"]);
    } finally {
      await t2.close();
      await repo.cleanup();
    }
  });

  it("autocompleta módulos, docs e receitas", async () => {
    const mod = await t.client.complete({ ref: { type: "ref/resource", uri: "engine://module/{key}" }, argument: { name: "key", value: "ph" } });
    expect(mod.completion.values).toEqual(["physics"]);
    const doc = await t.client.complete({ ref: { type: "ref/resource", uri: "engine://docs/{name}" }, argument: { name: "name", value: "r" } });
    expect(doc.completion.values.sort()).toEqual(["RECIPES", "RULES"]);
    const rec = await t.client.complete({ ref: { type: "ref/resource", uri: "engine://recipe/{name}" }, argument: { name: "name", value: "1" } });
    expect(rec.completion.values.every((v) => v.startsWith("1"))).toBe(true);
    expect(rec.completion.values.length).toBeGreaterThan(0);
  });
});

describe("prompts", () => {
  it("lista os 4 prompts com argumentos", async () => {
    const { prompts } = await t.client.listPrompts();
    const byName = Object.fromEntries(prompts.map((p) => [p.name, p]));
    expect(Object.keys(byName).sort()).toEqual(["corrigir-gate", "criar-jogo", "investigar-bug-runtime", "nova-cena"]);
    expect(byName["criar-jogo"]!.arguments!.map((a) => a.name)).toEqual(["id", "nome", "ideia"]);
    expect(byName["corrigir-gate"]!.arguments!.map((a) => a.name)).toEqual(["gate"]);
    expect(byName["investigar-bug-runtime"]!.arguments!.map((a) => a.name)).toEqual(["id", "sintoma"]);
    expect(byName["nova-cena"]!.arguments!.map((a) => a.name)).toEqual(["id", "descricao"]);
  });

  it("renderiza instruções citando tools e RULES.md", async () => {
    const tools = new Set((await t.listTools()).map((x) => x.name));
    const cases: Array<[string, Record<string, string>, string[]]> = [
      ["criar-jogo", { id: "meu-jogo", nome: "Meu Jogo", ideia: "plataforma 3D" }, ["project_create", "module_api", "gaps_list", "project_check"]],
      ["corrigir-gate", { gate: "tsc" }, ["gate_run", "project_write_file"]],
      ["investigar-bug-runtime", { id: "physics-sandbox", sintoma: "cai pelo chão" }, ["runtime_launch", "logs_tail", "screenshot"]],
      ["nova-cena", { id: "meu-jogo", descricao: "fase com 3 caixas" }, ["scene_create", "scene_validate"]],
    ];
    for (const [name, args, mustCite] of cases) {
      const res = await t.client.getPrompt({ name, arguments: args });
      const text = (res.messages[0]!.content as { text: string }).text;
      expect(text).toContain("docs/ai/RULES.md");
      for (const v of Object.values(args)) expect(text).toContain(v);
      for (const tool of mustCite) expect(text).toContain(tool);
      // ferramentas do próprio domínio citadas existem de fato
      for (const own of ["docs_read", "module_api", "gaps_list", "docs_search", "recipe_read", "recipes_list", "engine_info", "docs_index"]) {
        if (text.includes(own)) expect(tools.has(own)).toBe(true);
      }
    }
  });

  it("recusa argumentos inválidos", async () => {
    await expect(t.client.getPrompt({ name: "criar-jogo", arguments: { id: "Mau Id", nome: "x", ideia: "y" } })).rejects.toThrow();
    await expect(t.client.getPrompt({ name: "corrigir-gate", arguments: { gate: "lint" } })).rejects.toThrow();
    await expect(t.client.getPrompt({ name: "nova-cena", arguments: { id: "x" } })).rejects.toThrow();
  });
});

describe("parsers (unidade)", () => {
  it("splitRow respeita \\|", () => {
    expect(splitRow("| a | b \\| c | d |")).toEqual(["a", "b | c", "d"]);
    expect(splitRow("texto")).toBeNull();
  });

  it("parseGaps ignora a seção Resolvido e tabelas de outro formato", () => {
    const md = [
      "## Resolvido",
      "| # | G | Tipo | Problema | Contorno |",
      "|---|---|---|---|---|",
      "| G1 | A | LACUNA | velho | x |",
      "## net",
      "| # | G | Tipo | Problema | Contorno |",
      "|---|---|---|---|---|",
      "| G8 | M | LACUNA | p \\| q | c |",
      "",
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
    ].join("\n");
    expect(parseGaps(md)).toEqual([{ id: "G8", severity: "M", type: "LACUNA", problem: "p | q", workaround: "c", section: "net", line: 8 }]);
  });

  it("parseIndex e parseModuleDoc sobre os arquivos reais", () => {
    const idx = parseIndex(read("docs/ai/INDEX.md"));
    expect(idx.modules).toHaveLength(moduleKeys.length);
    const doc = parseModuleDoc(read("docs/ai/modules/world.md"));
    expect(doc.capability).toBe("game.world@1.0.0");
    expect(doc.events.length).toBeGreaterThan(0);
    expect(doc.commands.every((c) => c.type.startsWith("game.world."))).toBe(true);
  });

  it("parseTokenSource: JSDoc, opcional, tags, alias e capability", () => {
    const api = parseTokenSource(
      [
        'import { defineCapability } from "@core";',
        "/** API x. */",
        "export interface XApi {",
        "  /** Faz y.",
        "   * @deprecated use z */",
        "  y<T>(a: T, b?: number): Promise<T>;",
        "  readonly n?: number;",
        "}",
        "export type Mode = 'a' | 'b';",
        'export const XToken = defineCapability<XApi>("game.x", "2.0.0");',
      ].join("\n"),
    );
    expect(api.interfaces[0]).toMatchObject({ name: "XApi", exported: true, doc: "API x." });
    expect(api.interfaces[0]!.members[0]).toMatchObject({
      name: "y",
      kind: "method",
      signature: "y<T>(a: T, b?: number): Promise<T>",
      doc: "Faz y.",
      tags: [{ tag: "deprecated", text: "use z" }],
    });
    expect(api.interfaces[0]!.members[1]).toMatchObject({ name: "n", kind: "property", optional: true, readonly: true });
    expect(api.types[0]).toMatchObject({ name: "Mode", signature: "type Mode = 'a' | 'b'" });
    expect(api.capabilities).toEqual([{ constName: "XToken", api: "XApi", id: "game.x", version: "2.0.0" }]);
  });

  it("textOf do resumo de engine_info", async () => {
    const raw = await t.callToolRaw("engine_info");
    expect(textOf(raw)).toMatch(/módulos/);
  });
});
