// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseTscOutput, toPascal } from "../../tools/mcp/src/tools/projects.ts";
import { createTestClient, makeTempRepo, REPO_ROOT, textOf, type TempRepo, type TestClient } from "./harness.ts";

const isWindows = process.platform === "win32";

describe("projects: leitura no repo real", () => {
  let t: TestClient;
  beforeAll(async () => {
    t = await createTestClient();
  });
  afterAll(async () => {
    await t.close();
  });

  it("project_list mostra physics-sandbox e esconde _template", async () => {
    const out = await t.callTool("project_list");
    const ids = out.projects.map((p: { id: string }) => p.id);
    expect(ids).toContain("physics-sandbox");
    expect(ids).not.toContain("_template");
    const sandbox = out.projects.find((p: { id: string }) => p.id === "physics-sandbox");
    expect(sandbox).toMatchObject({ name: "Physics Sandbox (exemplo)", declaredId: "physics-sandbox", hasIndex: true, path: "src/projects/physics-sandbox" });
    expect(sandbox.files).toBeGreaterThan(5);
    expect(out.templates).toEqual(["minimal", "physics"]);
  });

  it("project_files e project_read_file leem o jogo", async () => {
    const files = await t.callTool("project_files", { id: "physics-sandbox" });
    expect(files.files.map((f: { path: string }) => f.path)).toContain("ports/PhysicsSandboxViewPort.ts");
    const read = await t.callTool("project_read_file", { id: "physics-sandbox", path: "index.ts" });
    expect(read.content).toContain("export const project");
    expect(read.bytes).toBe(readFileSync(path.join(REPO_ROOT, "src/projects/physics-sandbox/index.ts")).length);
  });

  it("erros de leitura: jogo inexistente, arquivo inexistente, fora do jogo, id inválido", async () => {
    await expect(t.callTool("project_files", { id: "nao-existe" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(t.callTool("project_read_file", { id: "physics-sandbox", path: "nada.ts" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(t.callTool("project_read_file", { id: "physics-sandbox", path: "../../core/index.ts" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(t.callTool("project_read_file", { id: "physics-sandbox", path: "/etc/passwd" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(t.callTool("project_files", { id: "_template" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(t.callTool("project_files", { id: "../x" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("helpers puros: toPascal e parseTscOutput", () => {
    expect(toPascal("meu-jogo")).toBe("MeuJogo");
    expect(toPascal("3d-run")).toBe("Game3dRun");
    const parsed = parseTscOutput(
      "src/projects/a/x.ts(3,5): error TS2322: Type 'number' is not assignable\n  to type 'string'.\nsrc/core/y.ts(1,1): error TS1005: ';' expected.\n",
    );
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ file: "src/projects/a/x.ts", line: 3, column: 5, code: "TS2322" });
    expect(parsed[0]!.message).toContain("to type 'string'.");
  });
});

describe("projects: escrita em repositório temporário", () => {
  let repo: TempRepo;
  let t: TestClient;
  beforeAll(async () => {
    repo = await makeTempRepo();
    t = await createTestClient({ root: repo.root });
  });
  afterAll(async () => {
    await t.close();
    await repo.cleanup();
  });

  it("project_create minimal gera os arquivos e o jogo aparece no project_list", async () => {
    const out = await t.callTool("project_create", { id: "meu-jogo", name: 'Meu "Jogo"' });
    expect(out.template).toBe("minimal");
    expect(out.files).toEqual(["ENGINE_REPORT.md", "MeuJogoGame.ts", "MeuJogoPlugin.ts", "index.ts", "meu-jogo.test.ts"]);
    const index = readFileSync(path.join(repo.root, "src/projects/meu-jogo/index.ts"), "utf8");
    expect(index).toContain('id: "meu-jogo"');
    expect(index).toContain('name: "Meu \\"Jogo\\""');
    expect(index).not.toMatch(/__[A-Z_]+__/);
    const list = await t.callTool("project_list");
    expect(list.projects).toEqual([
      expect.objectContaining({ id: "meu-jogo", name: 'Meu "Jogo"', declaredId: "meu-jogo", hasReport: true, hasDesktopJson: false }),
    ]);
  });

  it("project_create physics com desktop.json válido para buildProjectTauriConfig", async () => {
    const out = await t.callTool("project_create", {
      id: "caixas",
      name: "Caixas",
      template: "physics",
      withDesktopJson: true,
      desktop: { window: { width: 1600 } },
    });
    expect(out.files).toEqual(
      expect.arrayContaining(["index.ts", "CaixasPlugin.ts", "CaixasGame.ts", "ports/CaixasViewPort.ts", "adapters/ThreeCaixasView.ts", "caixas.test.ts", "desktop.json"]),
    );
    const desktop = JSON.parse(readFileSync(path.join(repo.root, "src/projects/caixas/desktop.json"), "utf8"));
    expect(desktop).toEqual({ productName: "Caixas", identifier: "com.projeto1.caixas", window: { title: "Caixas", width: 1600, height: 720, resizable: true } });
    const { buildProjectTauriConfig } = (await import(pathToFileURL(path.join(REPO_ROOT, "scripts/tauri-project-config.mjs")).href)) as {
      buildProjectTauriConfig: (id: string, d: unknown, w: unknown) => { identifier: string };
    };
    expect(buildProjectTauriConfig("caixas", desktop, {}).identifier).toBe("com.projeto1.caixas");
  });

  it("project_create recusa existente, reservados, desktop inválido e não deixa lixo", async () => {
    await expect(t.callTool("project_create", { id: "meu-jogo", name: "X" })).rejects.toMatchObject({ code: "PROJECT_EXISTS" });
    await expect(t.callTool("project_create", { id: "none", name: "X" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(t.callTool("project_create", { id: "_outro", name: "X" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(t.callTool("project_create", { id: "ok-id", name: "" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(t.callTool("project_create", { id: "ok-id", name: "X", template: "rpg" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      t.callTool("project_create", { id: "host-id", name: "X", desktop: { identifier: "com.projeto1.game" } }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(t.callTool("project_create", { id: "chave-ruim", name: "X", desktop: { icone: "a.png" } })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(existsSync(path.join(repo.root, "src/projects/host-id"))).toBe(false);
    expect(existsSync(path.join(repo.root, "src/projects/chave-ruim"))).toBe(false);
  });

  it("project_write_file grava dentro do jogo (atômico, cria pastas)", async () => {
    const out = await t.callTool("project_write_file", { id: "meu-jogo", path: "systems/score.ts", content: "export const SCORE = 1;\n" });
    expect(out).toEqual({ id: "meu-jogo", path: "systems/score.ts", bytes: 24, created: true });
    const again = await t.callTool("project_write_file", { id: "meu-jogo", path: "systems/score.ts", content: "export const SCORE = 2;\n" });
    expect(again.created).toBe(false);
    const read = await t.callTool("project_read_file", { id: "meu-jogo", path: "systems/score.ts" });
    expect(read.content).toBe("export const SCORE = 2;\n");
    const files = await t.callTool("project_files", { id: "meu-jogo" });
    expect(files.files.map((f: { path: string }) => f.path)).toContain("systems/score.ts");
  });

  it("project_write_file recusa fora do jogo, _template, grande demais e jogo inexistente", async () => {
    await expect(t.callTool("project_write_file", { id: "meu-jogo", path: "../caixas/index.ts", content: "x" })).rejects.toMatchObject({ code: "WRITE_FORBIDDEN" });
    await expect(t.callTool("project_write_file", { id: "meu-jogo", path: "../../core/x.ts", content: "x" })).rejects.toMatchObject({ code: "WRITE_FORBIDDEN" });
    await expect(t.callTool("project_write_file", { id: "meu-jogo", path: "/tmp/x.ts", content: "x" })).rejects.toMatchObject({ code: "WRITE_FORBIDDEN" });
    await expect(t.callTool("project_write_file", { id: "_template", path: "index.ts", content: "x" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(t.callTool("project_write_file", { id: "fantasma", path: "index.ts", content: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      t.callTool("project_write_file", { id: "meu-jogo", path: "grande.txt", content: "a".repeat(1024 * 1024 + 1) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(existsSync(path.join(repo.root, "src/projects/meu-jogo/grande.txt"))).toBe(false);
  });

  it.skipIf(isWindows)("link simbólico dentro do jogo que sai dele é recusado (leitura e escrita)", async () => {
    await symlink(path.join(repo.root, "src/projects/_template"), path.join(repo.root, "src/projects/meu-jogo/link"));
    await expect(t.callTool("project_write_file", { id: "meu-jogo", path: "link/index.ts", content: "x" })).rejects.toMatchObject({ code: "WRITE_FORBIDDEN" });
    await expect(t.callTool("project_read_file", { id: "meu-jogo", path: "link/index.ts" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("project_read_file recusa binário", async () => {
    await writeFile(path.join(repo.root, "src/projects/meu-jogo/img.bin"), Buffer.from([1, 0, 2]));
    await expect(t.callTool("project_read_file", { id: "meu-jogo", path: "img.bin" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("project_report_append cria com cabeçalho quando falta e anexa entradas", async () => {
    // remove o relatório criado pelo template para testar a criação
    const reportAbs = path.join(repo.root, "src/projects/caixas/ENGINE_REPORT.md");
    await t.ctx.paths.remove("src/projects/caixas/ENGINE_REPORT.md");
    const first = await t.callTool("project_report_append", { id: "caixas", module: "physics", kind: "gap", text: "Falta castShape." });
    expect(first).toMatchObject({ created: true, entries: 1, path: "src/projects/caixas/ENGINE_REPORT.md" });
    expect(first.entry).toMatch(/^## \d{4}-\d{2}-\d{2} — physics — gap\n\nFalta castShape\.\n$/);
    const second = await t.callTool("project_report_append", { id: "caixas", module: "game.render", kind: "ok", text: "Sombras ok." });
    expect(second).toMatchObject({ created: false, entries: 2 });
    const content = readFileSync(reportAbs, "utf8");
    expect(content.startsWith("# ENGINE_REPORT — Caixas\n")).toBe(true);
    expect(content).toContain("— physics — gap");
    expect(content).toContain("— game.render — ok");
  });

  it("project_report_append: erros de entrada e jogo inexistente", async () => {
    await expect(t.callTool("project_report_append", { id: "caixas", module: "physics", kind: "elogio", text: "x" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(t.callTool("project_report_append", { id: "caixas", module: "Física!", kind: "bug", text: "x" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(t.callTool("project_report_append", { id: "caixas", module: "physics", kind: "bug", text: "   " })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(t.callTool("project_report_append", { id: "fantasma", module: "physics", kind: "bug", text: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("project_check: etapa ausente no repo mínimo falha de forma estruturada", async () => {
    const out = await t.callTool("project_check", { id: "meu-jogo", steps: ["isolation"] });
    expect(out.ok).toBe(false);
    expect(out.steps).toHaveLength(1);
    expect(out.steps[0]).toMatchObject({ name: "isolation", ok: false });
    expect(out.steps[0].summary).toContain("não encontrado");
    await expect(t.callTool("project_check", { id: "fantasma" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("project_delete exige confirm, nunca apaga _template e remove o jogo", async () => {
    await expect(t.callTool("project_delete", { id: "meu-jogo", confirm: "outro" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(t.callTool("project_delete", { id: "_template", confirm: "_template" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const out = await t.callTool("project_delete", { id: "meu-jogo", confirm: "meu-jogo" });
    expect(out.removedFiles).toBeGreaterThanOrEqual(6);
    expect(existsSync(path.join(repo.root, "src/projects/meu-jogo"))).toBe(false);
    expect(existsSync(path.join(repo.root, "src/projects/_template/index.ts"))).toBe(true);
    await expect(t.callTool("project_delete", { id: "meu-jogo", confirm: "meu-jogo" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("projects: modo somente leitura", () => {
  it("project_create e project_write_file devolvem READONLY", async () => {
    const repo = await makeTempRepo();
    const t = await createTestClient({ root: repo.root, config: { readonly: true } });
    try {
      await expect(t.callTool("project_create", { id: "ro", name: "RO" })).rejects.toMatchObject({ code: "READONLY" });
      expect(existsSync(path.join(repo.root, "src/projects/ro"))).toBe(false);
    } finally {
      await t.close();
      await repo.cleanup();
    }
  });
});

describe("projects: project_check real (tsc + vitest) num repo temporário", () => {
  let repo: TempRepo;
  let t: TestClient;
  beforeAll(async () => {
    repo = await makeTempRepo({ copy: ["src", "tsconfig.json", "vite.config.ts"] });
    await symlink(path.join(REPO_ROOT, "node_modules"), path.join(repo.root, "node_modules"), isWindows ? "junction" : "dir");
    t = await createTestClient({ root: repo.root });
  }, 60_000);
  afterAll(async () => {
    await t?.close();
    await repo?.cleanup();
  });

  it(
    "jogos gerados (minimal e physics) passam tsc e os próprios testes; erro no jogo aparece filtrado",
    async () => {
      await t.callTool("project_create", { id: "check-min", name: "Check Min" });
      await t.callTool("project_create", { id: "check-fis", name: "Check Física", template: "physics", withDesktopJson: true });

      const okMin = await t.callTool("project_check", { id: "check-min", steps: ["tsc", "tests"] });
      expect(okMin.steps[0]).toMatchObject({ name: "tsc", ok: true, failures: [], ignoredErrors: 0 });
      expect(okMin.steps[1]).toMatchObject({ name: "tests", ok: true, tests: { total: 3, passed: 3, failed: 0, files: 1 } });
      expect(okMin.ok).toBe(true);

      const okFis = await t.callTool("project_check", { id: "check-fis", steps: ["tests"] });
      expect(okFis.steps[0]).toMatchObject({ name: "tests", ok: true, tests: { total: 4, passed: 4, failed: 0, files: 1 } });

      // Erro de tipo no jogo físico: aparece no check dele e é ignorado no check do minimal.
      await t.callTool("project_write_file", { id: "check-fis", path: "quebrado.ts", content: "export const n: number = \"texto\";\n" });
      await t.callTool("project_write_file", {
        id: "check-min",
        path: "falha.test.ts",
        content: 'import { it, expect } from "vitest";\nit("falha de propósito", () => { expect(1).toBe(2); });\n',
      });
      const raw = await t.callToolRaw("project_check", { id: "check-fis", steps: ["tsc"] });
      const bad = raw.structuredContent as { ok: boolean; steps: Array<{ ok: boolean; failures: Array<{ file: string; line?: number; code?: string }> }> };
      expect(bad.ok).toBe(false);
      expect(bad.steps[0]!.failures).toEqual([expect.objectContaining({ file: "src/projects/check-fis/quebrado.ts", line: 1, code: "TS2322" })]);
      expect(textOf(raw)).toContain("FALHOU");

      const other = await t.callTool("project_check", { id: "check-min", steps: ["tsc", "tests"] });
      expect(other.steps[0]).toMatchObject({ ok: true, ignoredErrors: 1 });
      expect(other.steps[1].ok).toBe(false);
      expect(other.steps[1].failures).toEqual([expect.objectContaining({ file: "src/projects/check-min/falha.test.ts" })]);
      expect(other.ok).toBe(false);
    },
    240_000,
  );
});
