// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { loadConfig } from "../../tools/mcp/src/core/config.ts";
import { McpToolError } from "../../tools/mcp/src/core/errors.ts";
import { assertCommandAllowed, ensureSuccess, Executor, resolveCommand } from "../../tools/mcp/src/core/exec.ts";
import { JobManager, RingLog } from "../../tools/mcp/src/core/jobs.ts";
import { createRepoPaths, detectRepoRoot, validateProjectId } from "../../tools/mcp/src/core/paths.ts";
import { defineResource, definePrompt, defineTool, toolResult } from "../../tools/mcp/src/core/registry.ts";
import { allTools } from "../../tools/mcp/src/tools/index.ts";
import {
  createTestClient,
  errorOf,
  HAS_GIT,
  isAlive,
  makeTempRepo,
  REPO_ROOT,
  textOf,
  waitFor,
  type TempRepo,
  type TestClient,
} from "./harness.ts";

const isWindows = process.platform === "win32";

function expectToolError(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(McpToolError);
    expect((error as McpToolError).code).toBe(code);
    return;
  }
  throw new Error(`esperava McpToolError ${code}`);
}

async function expectToolErrorAsync(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

/* ========================================================================== */

describe("servidor: tools/list e envelope", () => {
  let t: TestClient;
  beforeAll(async () => {
    t = await createTestClient();
  });
  afterAll(async () => {
    await t.close();
  });

  it("lista engine_ping e as tools job_*", async () => {
    const names = (await t.listTools()).map((tool) => tool.name);
    for (const n of ["engine_ping", "job_list", "job_status", "job_log", "job_cancel"]) expect(names).toContain(n);
  });

  it("nomes únicos, snake_case e com descrição em todos os domínios", async () => {
    const tools = allTools();
    const names = tools.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
    for (const d of tools) {
      expect(d.name).toMatch(/^[a-z][a-z0-9_]+$/);
      expect(d.description.length).toBeGreaterThan(10);
    }
    const listed = await t.listTools();
    expect(listed.length).toBe(tools.length);
    const ping = listed.find((x) => x.name === "engine_ping")!;
    expect(ping.outputSchema).toBeDefined();
    expect(ping.inputSchema.type).toBe("object");
  });

  it("engine_ping devolve structuredContent + resumo em texto", async () => {
    const raw = await t.callToolRaw("engine_ping");
    expect(raw.isError).toBeFalsy();
    expect(raw.structuredContent).toMatchObject({ ok: true, root: t.ctx.root, version: t.ctx.version, readonly: false });
    expect(textOf(raw)).toContain("ok em");
    expect(textOf(raw)).toContain('"ok": true');
  });

  it("entrada inválida vira INVALID_INPUT estruturado (tipo errado e chave desconhecida)", async () => {
    const wrongType = await t.callToolRaw("job_status", { jobId: 5 });
    expect(wrongType.isError).toBe(true);
    expect(errorOf(wrongType)).toMatchObject({ code: "INVALID_INPUT" });
    expect(textOf(wrongType)).toContain("INVALID_INPUT");
    await expectToolErrorAsync(t.callTool("engine_ping", { extra: 1 }), "INVALID_INPUT");
    await expectToolErrorAsync(t.callTool("job_status", {}), "INVALID_INPUT");
  });

  it("job_status de job inexistente: NOT_FOUND com dica", async () => {
    const err = await t.callTool("job_status", { jobId: "job-nada" }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "NOT_FOUND" });
    expect((err as { hint?: string }).hint).toMatch(/job_list/);
  });
});

/* ========================================================================== */

describe("registry: defineTool/defineResource/definePrompt", () => {
  let t: TestClient;
  beforeAll(async () => {
    const tools = [
      defineTool({
        name: "t_echo",
        description: "devolve a entrada para teste",
        input: { text: z.string(), n: z.number().int().optional() },
        output: { text: z.string(), n: z.number() },
        run: ({ text, n }) => ({ text, n: n ?? 0 }),
        summarize: (out) => `eco ${out.text}`,
      }),
      defineTool({
        name: "t_fail",
        description: "lança McpToolError para teste",
        input: z.object({ code: z.string() }),
        run: ({ code }) => {
          throw new McpToolError(code, "falhou de propósito", "uma dica");
        },
      }),
      defineTool({
        name: "t_fail_output",
        description: "falha com schema de saída para teste",
        output: { ok: z.boolean() },
        run: () => {
          throw new McpToolError("NOT_FOUND", "sumiu");
        },
      }),
      defineTool({
        name: "t_crash",
        description: "lança erro inesperado para teste",
        run: () => {
          throw new Error("boom");
        },
      }),
      defineTool({
        name: "t_bad_output",
        description: "saída fora do schema para teste",
        output: { ok: z.boolean() },
        run: () => ({ ok: "sim" }) as unknown as { ok: boolean },
      }),
      defineTool({
        name: "t_image",
        description: "devolve imagem para teste",
        run: () =>
          toolResult({
            data: { width: 1, height: 1 },
            summary: "uma imagem",
            images: [{ data: Buffer.from("png").toString("base64"), mimeType: "image/png" }],
          }),
      }),
      defineTool({
        name: "t_array",
        description: "devolve array para teste",
        run: () => [1, 2, 3] as unknown as object,
      }),
      defineTool({
        name: "t_ctx",
        description: "usa o contexto para teste",
        run: async (_a, ctx, call) => ({ root: ctx.root, aborted: call.signal.aborted }),
      }),
    ];
    const resources = [
      defineResource({ name: "fixo", uri: "engine://teste/fixo", mimeType: "text/markdown", read: () => "# fixo" }),
      defineResource({
        name: "modelo",
        uri: "engine://teste/item/{key}",
        list: () => [{ uri: "engine://teste/item/a", name: "a" }],
        complete: { key: (v) => ["a", "b"].filter((k) => k.startsWith(v)) },
        read: (_uri, vars) => {
          if (vars.key === "x") throw new McpToolError("NOT_FOUND", "item x não existe");
          return { text: `item ${vars.key}`, mimeType: "text/plain" };
        },
      }),
    ];
    const prompts = [
      definePrompt({
        name: "p-teste",
        description: "prompt de teste",
        args: { id: z.string(), extra: z.string().optional() },
        render: ({ id }) => `Crie o jogo ${id}`,
      }),
      definePrompt({ name: "p-sem-args", render: () => "olá" }),
    ];
    t = await createTestClient({ domains: [{ name: "teste", module: { tools } }], resources, prompts });
  });
  afterAll(async () => {
    await t.close();
  });

  it("sucesso com output schema e resumo", async () => {
    const raw = await t.callToolRaw("t_echo", { text: "oi" });
    expect(raw.structuredContent).toEqual({ text: "oi", n: 0 });
    expect(textOf(raw).startsWith("eco oi")).toBe(true);
  });

  it("McpToolError vira isError + {code,message,hint} (structuredContent sem output schema)", async () => {
    const raw = await t.callToolRaw("t_fail", { code: "WRITE_FORBIDDEN" });
    expect(raw.isError).toBe(true);
    expect(raw.structuredContent).toEqual({ code: "WRITE_FORBIDDEN", message: "falhou de propósito", hint: "uma dica" });
    expect(errorOf(raw)).toMatchObject({ code: "WRITE_FORBIDDEN", hint: "uma dica" });
  });

  it("erro em tool com output schema: payload em _meta, sem structuredContent", async () => {
    const raw = await t.callToolRaw("t_fail_output");
    expect(raw.isError).toBe(true);
    expect(raw.structuredContent).toBeUndefined();
    expect(errorOf(raw)).toMatchObject({ code: "NOT_FOUND", message: "sumiu" });
  });

  it("erro inesperado vira INTERNAL; saída fora do schema também", async () => {
    await expectToolErrorAsync(t.callTool("t_crash"), "INTERNAL");
    await expectToolErrorAsync(t.callTool("t_bad_output"), "INTERNAL");
  });

  it("toolResult com imagem e array embrulhado em items", async () => {
    const raw = await t.callToolRaw("t_image");
    expect(raw.content?.[1]).toMatchObject({ type: "image", mimeType: "image/png" });
    expect(textOf(raw)).toContain("uma imagem");
    expect(await t.callTool("t_array")).toEqual({ items: [1, 2, 3] });
    expect(await t.callTool("t_ctx")).toEqual({ root: t.ctx.root, aborted: false });
  });

  it("resources fixos e por template (list, read, erro)", async () => {
    const list = await t.client.listResources();
    expect(list.resources.map((r) => r.uri)).toEqual(expect.arrayContaining(["engine://teste/fixo", "engine://teste/item/a"]));
    const fixed = await t.client.readResource({ uri: "engine://teste/fixo" });
    expect(fixed.contents[0]).toMatchObject({ text: "# fixo", mimeType: "text/markdown" });
    const item = await t.client.readResource({ uri: "engine://teste/item/b" });
    expect(item.contents[0]).toMatchObject({ text: "item b" });
    await expect(t.client.readResource({ uri: "engine://teste/item/x" })).rejects.toThrow(/NOT_FOUND/);
    const templates = await t.client.listResourceTemplates();
    expect(templates.resourceTemplates[0]?.uriTemplate).toBe("engine://teste/item/{key}");
  });

  it("prompts com e sem argumentos", async () => {
    const list = await t.client.listPrompts();
    expect(list.prompts.map((p) => p.name).sort()).toEqual(["p-sem-args", "p-teste"]);
    const p = await t.client.getPrompt({ name: "p-teste", arguments: { id: "meu-jogo" } });
    expect(p.messages[0]?.content).toMatchObject({ type: "text", text: "Crie o jogo meu-jogo" });
    const q = await t.client.getPrompt({ name: "p-sem-args" });
    expect(q.messages[0]?.content).toMatchObject({ text: "olá" });
  });

  it("defineTool recusa nome fora de snake_case", () => {
    expect(() => defineTool({ name: "Bad-Name", description: "x", run: () => ({}) })).toThrow(/snake_case/);
  });
});

/* ========================================================================== */

describe("paths", () => {
  let repo: TempRepo;
  let outside: string;
  beforeAll(async () => {
    repo = await makeTempRepo();
    outside = await mkdtemp(path.join(os.tmpdir(), "engine-mcp-outside-"));
    await writeFile(path.join(outside, "segredo.txt"), "x");
    await mkdir(path.join(repo.root, "src", "engine", "core"), { recursive: true });
    await mkdir(path.join(repo.root, "src", "projects", "meu-jogo"), { recursive: true });
    if (!isWindows) {
      await symlink(outside, path.join(repo.root, "link-fora"));
      await symlink(path.join(repo.root, "src", "engine"), path.join(repo.root, "src", "projects", "meu-jogo", "engine-link"));
    }
  });
  afterAll(async () => {
    await repo.cleanup();
    await rm(outside, { recursive: true, force: true });
  });

  it("makeTempRepo copia template e docs/ai", () => {
    expect(existsSync(path.join(repo.root, "src/projects/_template"))).toBe(true);
    expect(existsSync(path.join(repo.root, "docs/ai/INDEX.md"))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(repo.root, "package.json"), "utf8")).name).toBe("projeto1");
  });

  it("detectRepoRoot: ENGINE_MCP_ROOT ou subindo até package.json projeto1", () => {
    expect(detectRepoRoot({ ENGINE_MCP_ROOT: repo.root })).toBe(repo.root);
    expect(detectRepoRoot({})).toBe(createRepoPaths(REPO_ROOT).root);
    expect(loadConfig({ ENGINE_MCP_ROOT: repo.root, ENGINE_MCP_READONLY: "1" })).toMatchObject({ root: repo.root, readonly: true, bridgePort: 47100 });
    expect(loadConfig({ ENGINE_MCP_ROOT: repo.root, ENGINE_MCP_BRIDGE_PORT: "47200" }).bridgePort).toBe(47200);
    expectToolError(() => loadConfig({ ENGINE_MCP_ROOT: repo.root, ENGINE_MCP_BRIDGE_PORT: "abc" }), "INVALID_INPUT");
  });

  it("resolve recusa escapes com '..' e absolutos fora da raiz", () => {
    const p = createRepoPaths(repo.root);
    expectToolError(() => p.resolve("../fora.txt"), "PATH_OUTSIDE_REPO");
    expectToolError(() => p.resolve("src/../../fora.txt"), "PATH_OUTSIDE_REPO");
    expectToolError(() => p.resolve(path.join(outside, "segredo.txt")), "PATH_OUTSIDE_REPO");
    expectToolError(() => p.resolve(isWindows ? "C:\\Windows" : "/etc/passwd"), "PATH_OUTSIDE_REPO");
    expectToolError(() => p.resolve(""), "INVALID_INPUT");
    expectToolError(() => p.resolve("a\0b"), "INVALID_INPUT");
    expect(p.resolve("src/../package.json")).toBe(path.join(repo.root, "package.json"));
    expect(p.resolve(path.join(repo.root, "docs"))).toBe(path.join(repo.root, "docs"));
    expect(p.relative(path.join(repo.root, "src", "projects"))).toBe("src/projects");
  });

  it.skipIf(isWindows)("resolve recusa link simbólico que aponta para fora (arquivo existente ou não)", () => {
    const p = createRepoPaths(repo.root);
    expectToolError(() => p.resolve("link-fora/segredo.txt"), "PATH_OUTSIDE_REPO");
    expectToolError(() => p.resolve("link-fora/novo/arquivo.txt"), "PATH_OUTSIDE_REPO");
    expectToolError(() => p.resolve("link-fora"), "PATH_OUTSIDE_REPO");
  });

  it("assertWritable: só áreas de jogo, docs/games, src-tauri/gen e dist", () => {
    const p = createRepoPaths(repo.root);
    for (const ok of ["src/projects/meu-jogo/main.ts", "src/projects/meu-jogo", "docs/games/meu-jogo/notas.md", "src-tauri/gen/steam/x.vdf", "dist/meu-jogo/index.html"]) {
      expect(p.assertWritable(ok)).toBe(path.join(repo.root, ok));
      expect(p.isWritable(ok)).toBe(true);
    }
    for (const bad of [
      "src/engine/core/x.ts",
      "src/projects/_template/main.ts",
      "src/projects/Meu_Jogo/main.ts",
      "src/projects",
      "src/project.ts",
      "package.json",
      "docs/ai/INDEX.md",
      "docs/games",
      "src-tauri/src/main.rs",
      "dist",
      ".freeze-lock.json",
      "LAYER1_BASELINE_V1.json",
    ]) {
      expectToolError(() => p.assertWritable(bad), "WRITE_FORBIDDEN");
      expect(p.isWritable(bad)).toBe(false);
    }
    expectToolError(() => p.assertWritable("../fora/src/projects/x/a.ts"), "PATH_OUTSIDE_REPO");
  });

  it.skipIf(isWindows)("assertWritable recusa link dentro do jogo apontando para a engine", () => {
    const p = createRepoPaths(repo.root);
    expectToolError(() => p.assertWritable("src/projects/meu-jogo/engine-link/core/x.ts"), "WRITE_FORBIDDEN");
  });

  it("modo READONLY recusa toda escrita", async () => {
    const p = createRepoPaths(repo.root, { readonly: true });
    expectToolError(() => p.assertWritable("src/projects/meu-jogo/main.ts"), "READONLY");
    await expect(p.writeFileAtomic("src/projects/meu-jogo/a.txt", "x")).rejects.toMatchObject({ code: "READONLY" });
    const t = await createTestClient({ root: repo.root, env: { ENGINE_MCP_READONLY: "1" } });
    try {
      expect(await t.callTool("engine_ping")).toMatchObject({ readonly: true });
      expect(t.ctx.paths.readonly).toBe(true);
    } finally {
      await t.close();
    }
  });

  it("writeFileAtomic grava, cria pastas e não deixa temporários; remove/mkdirp", async () => {
    const p = createRepoPaths(repo.root);
    const abs = await p.writeFileAtomic("src/projects/meu-jogo/sub/dados.json", '{"a":1}');
    expect(readFileSync(abs, "utf8")).toBe('{"a":1}');
    await p.writeFileAtomic("src/projects/meu-jogo/sub/dados.json", '{"a":2}');
    expect(readFileSync(abs, "utf8")).toBe('{"a":2}');
    expect(readdirSync(path.dirname(abs))).toEqual(["dados.json"]);
    await expect(p.writeFileAtomic("src/engine/core/x.ts", "x")).rejects.toMatchObject({ code: "WRITE_FORBIDDEN" });
    await p.mkdirp("docs/games/meu-jogo");
    expect(existsSync(path.join(repo.root, "docs/games/meu-jogo"))).toBe(true);
    await p.remove("src/projects/meu-jogo/sub");
    expect(existsSync(path.dirname(abs))).toBe(false);
  });

  it("validateProjectId e projectDir", () => {
    const p = createRepoPaths(repo.root);
    expect(validateProjectId("meu-jogo-2")).toBe("meu-jogo-2");
    for (const bad of ["", "_template", "-x", "Meu", "a/b", "..", "a".repeat(64), 3]) expectToolError(() => validateProjectId(bad), "INVALID_INPUT");
    expect(p.projectDir("meu-jogo")).toBe(path.join(repo.root, "src", "projects", "meu-jogo"));
    expectToolError(() => p.projectDir("../x"), "INVALID_INPUT");
  });
});

/* ========================================================================== */

describe("exec (allowlist)", () => {
  const exec = new Executor(createRepoPaths(REPO_ROOT));
  afterAll(async () => {
    await exec.disposeAll();
  });

  it("recusa comandos fora da allowlist", async () => {
    for (const cmd of ["bash", "sh", "rm", "cmd", "powershell", "curl", "node.exe", "npm.cmd"]) {
      await expectToolErrorAsync(exec.runAllowed(cmd, ["-c", "echo x"]), "COMMAND_NOT_ALLOWED");
    }
  });

  it("git: só leitura (push, commit, -c, branch com nome/-D, --output recusados)", async () => {
    for (const args of [
      ["push"],
      ["commit", "-m", "x"],
      ["reset", "--hard"],
      ["checkout", "."],
      ["-c", "core.pager=sh", "log"],
      ["-C", "/tmp", "status"],
      ["branch", "novo-branch"],
      ["branch", "-D", "main"],
      ["branch", "--set-upstream-to=origin/x"],
      ["diff", "--output=/tmp/x"],
      ["log", "--ext-diff"],
      [],
    ]) {
      expectToolError(() => assertCommandAllowed("git", args), "COMMAND_NOT_ALLOWED");
    }
    for (const args of [["status", "--porcelain"], ["log", "-1", "--oneline"], ["diff", "--stat"], ["rev-parse", "HEAD"], ["branch", "--show-current"], ["branch", "--list", "main*"], ["show", "HEAD:package.json"]]) {
      expect(() => assertCommandAllowed("git", args)).not.toThrow();
    }
    if (HAS_GIT) {
      const head = await exec.runAllowed("git", ["rev-parse", "--is-inside-work-tree"]);
      expect(head.code).toBe(0);
      expect(head.stdout.trim()).toBe("true");
    }
  });

  it("node roda sem shell, mescla env e respeita cwd dentro do repo", async () => {
    const r = await exec.runAllowed("node", ["-e", "console.log(process.env.FOO + '|' + process.cwd()); console.error('err')"], {
      env: { FOO: "bar" },
      cwd: "docs",
    });
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe(`bar|${path.join(createRepoPaths(REPO_ROOT).root, "docs")}`);
    expect(r.stderr.trim()).toBe("err");
    expect(r.timedOut).toBe(false);
    // Argumento com metacaracteres de shell chega literal.
    const lit = await exec.runAllowed("node", ["-e", "console.log(process.argv[1])", "$(echo hack); rm -rf /"]);
    expect(lit.stdout.trim()).toBe("$(echo hack); rm -rf /");
    await expectToolErrorAsync(exec.runAllowed("node", ["-v"], { cwd: "../" }), "PATH_OUTSIDE_REPO");
  });

  it("timeout mata o processo e marca timedOut", async () => {
    const r = await exec.runAllowed("node", ["-e", "setTimeout(() => {}, 20000)"], { timeoutMs: 300 });
    expect(r.timedOut).toBe(true);
    expect(r.code).not.toBe(0);
    expect(r.durationMs).toBeLessThan(10_000);
    expectToolError(() => ensureSuccess(r, "dorme"), "TIMEOUT");
  });

  it("AbortSignal cancela", async () => {
    const ac = new AbortController();
    const p = exec.runAllowed("node", ["-e", "setTimeout(() => {}, 20000)"], { signal: ac.signal });
    setTimeout(() => ac.abort(), 100);
    const r = await p;
    expect(r.aborted).toBe(true);
    expect(exec.running).toBe(0);
  });

  it("saída limitada a 2 MiB mantendo o fim; código != 0 vira COMMAND_FAILED", async () => {
    const r = await exec.runAllowed("node", ["-e", "process.stdout.write('a'.repeat(3*1024*1024) + 'FIM')"]);
    expect(r.code).toBe(0);
    expect(Buffer.byteLength(r.stdout)).toBe(2 * 1024 * 1024);
    expect(r.stdout.endsWith("FIM")).toBe(true);
    expect(r.stdoutDroppedBytes).toBe(3 * 1024 * 1024 + 3 - 2 * 1024 * 1024);
    const fail = await exec.runAllowed("node", ["-e", "console.error('ruim'); process.exit(2)"]);
    expect(fail.code).toBe(2);
    try {
      ensureSuccess(fail, "falha");
      throw new Error("não lançou");
    } catch (error) {
      expect(error).toMatchObject({ code: "COMMAND_FAILED", details: { code: 2 } });
    }
  });

  it("resolveCommand: node usa o Node atual; npm/npx no Windows viram node + *-cli.js", () => {
    expect(resolveCommand("node", ["-v"]).file).toBe(process.execPath);
    expect(resolveCommand("git", ["status"], "linux")).toEqual({ file: "git", args: ["status"] });
    try {
      const win = resolveCommand("npm", ["run", "x"], "win32");
      expect(win.file).toBe(process.execPath);
      expect(win.args[0]).toMatch(/npm-cli\.js$/);
      expect(win.args.slice(1)).toEqual(["run", "x"]);
    } catch (error) {
      expect(error).toMatchObject({ code: "COMMAND_FAILED" });
    }
  });

  it("npm roda pela allowlist", async () => {
    const r = await exec.runAllowed("npm", ["--version"], { timeoutMs: 60_000 });
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  }, 60_000);
});

/* ========================================================================== */

describe("jobs", () => {
  const exec = new Executor(createRepoPaths(REPO_ROOT));
  afterAll(async () => {
    await exec.disposeAll();
  });

  it("RingLog mantém offsets absolutos ao descartar o início", () => {
    const ring = new RingLog(10);
    ring.write(Buffer.from("0123456789"));
    ring.write(Buffer.from("abcde"));
    expect(ring.total).toBe(15);
    expect(ring.start).toBe(5);
    const r = ring.read(0, 100);
    expect(r).toMatchObject({ offset: 5, truncatedBefore: true });
    expect(r.data.toString()).toBe("56789abcde");
    expect(ring.read(12, 2).data.toString()).toBe("cd");
    expect(ring.read(15, 10).data.length).toBe(0);
    ring.write(Buffer.from("X".repeat(25)));
    expect(ring.start).toBe(30);
    expect(ring.read(0, 100).data.toString()).toBe("X".repeat(10));
  });

  it("start + log com offsets + sucesso", async () => {
    const jobs = new JobManager(exec);
    try {
      const script = "let i=0; const t=setInterval(()=>{ console.log('linha '+i); if(++i===5){clearInterval(t)} }, 30)";
      const info = jobs.start("linhas", "node", ["-e", script]);
      expect(info.state).toBe("running");
      expect(info.jobId).toMatch(/^job-/);
      await waitFor(() => jobs.readLog(info.jobId, 0).text.includes("linha 1"), 5000, "linha 1");
      const first = jobs.readLog(info.jobId, 0);
      expect(first.offset).toBe(0);
      const done = await jobs.wait(info.jobId);
      expect(done).toMatchObject({ state: "succeeded", exitCode: 0 });
      expect(done.endedAt).not.toBeNull();
      const rest = jobs.readLog(info.jobId, first.nextOffset);
      expect(rest.offset).toBe(first.nextOffset);
      expect(first.text + rest.text).toBe([0, 1, 2, 3, 4].map((i) => `linha ${i}\n`).join(""));
      expect(rest.done).toBe(true);
      const small = jobs.readLog(info.jobId, 2, 3);
      expect(small).toMatchObject({ offset: 2, nextOffset: 5, text: "nha" });
    } finally {
      await jobs.disposeAll();
    }
  });

  it("código de saída != 0 marca failed", async () => {
    const jobs = new JobManager(exec);
    try {
      const info = jobs.start("falha", "node", ["-e", "process.exit(3)"]);
      expect(await jobs.wait(info.jobId)).toMatchObject({ state: "failed", exitCode: 3 });
    } finally {
      await jobs.disposeAll();
    }
  });

  it("comando fora da allowlist não cria job", () => {
    const jobs = new JobManager(exec);
    expectToolError(() => jobs.start("x", "bash", ["-c", "sleep 1"]), "COMMAND_NOT_ALLOWED");
    expect(jobs.list()).toEqual([]);
    void jobs.disposeAll();
  });

  it.skipIf(isWindows)("cancel mata a árvore (inclusive netos)", async () => {
    const jobs = new JobManager(exec);
    try {
      const script =
        "const {spawn}=require('node:child_process'); const c=spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{stdio:'ignore'}); console.log('NETO '+c.pid); setTimeout(()=>{},60000)";
      const info = jobs.start("arvore", "node", ["-e", script]);
      await waitFor(() => /NETO \d+/.test(jobs.readLog(info.jobId).text), 5000, "pid do neto");
      const grandchild = Number(/NETO (\d+)/.exec(jobs.readLog(info.jobId).text)![1]);
      expect(isAlive(grandchild)).toBe(true);
      const final = await jobs.cancel(info.jobId);
      expect(final.state).toBe("cancelled");
      await waitFor(() => !isAlive(grandchild), 5000, "neto morrer");
      expect(await jobs.cancel(info.jobId)).toMatchObject({ state: "cancelled" });
    } finally {
      await jobs.disposeAll();
    }
  });

  it("limite de 4 jobs simultâneos (JOB_LIMIT) e liberação após cancelar", async () => {
    const jobs = new JobManager(exec);
    try {
      const ids = [0, 1, 2, 3].map((i) => jobs.start(`dorme ${i}`, "node", ["-e", "setTimeout(()=>{},30000)"]).jobId);
      expect(jobs.runningCount).toBe(4);
      expectToolError(() => jobs.start("quinto", "node", ["-e", "1"]), "JOB_LIMIT");
      await jobs.cancel(ids[0]!);
      const fifth = jobs.start("quinto", "node", ["-e", "1"]);
      expect(fifth.state).toBe("running");
      await jobs.wait(fifth.jobId);
    } finally {
      await jobs.disposeAll();
    }
    expect(jobs.runningCount).toBe(0);
  });

  it("log em anel: offset antigo devolve truncatedBefore; jobs terminados expiram", async () => {
    const jobs = new JobManager(exec, { logLimitBytes: 1024, ttlMs: 50 });
    try {
      const info = jobs.start("verboso", "node", ["-e", "process.stdout.write('x'.repeat(5000) + 'FIM')"]);
      await jobs.wait(info.jobId);
      const log = jobs.readLog(info.jobId, 0);
      expect(log.truncatedBefore).toBe(true);
      expect(log.logBytes).toBe(5003);
      expect(log.offset).toBe(5003 - 1024);
      expect(log.text.endsWith("FIM")).toBe(true);
      jobs.prune(Date.now() + 1000);
      expectToolError(() => jobs.status(info.jobId), "NOT_FOUND");
    } finally {
      await jobs.disposeAll();
    }
  });

  it("tools job_* pelo cliente MCP e disposeAll no close do servidor", async () => {
    const t = await createTestClient();
    const info = t.ctx.jobs.start("dorme", "node", ["-e", "console.log('começou'); setTimeout(()=>{},30000)"]);
    try {
      const list = await t.callTool("job_list");
      expect(list).toMatchObject({ running: 1, limit: 4 });
      expect(list.jobs[0].jobId).toBe(info.jobId);
      expect(await t.callTool("job_status", { jobId: info.jobId })).toMatchObject({ state: "running", label: "dorme", command: "node" });
      await waitFor(async () => (await t.callTool("job_log", { jobId: info.jobId })).text.includes("começou"), 5000, "log");
      const log = await t.callTool("job_log", { jobId: info.jobId, offset: 0, maxBytes: 3 });
      expect(log).toMatchObject({ offset: 0, nextOffset: 3, done: false });
      await expectToolErrorAsync(t.callTool("job_log", { jobId: info.jobId, offset: -1 }), "INVALID_INPUT");
      const cancelled = await t.callTool("job_cancel", { jobId: info.jobId });
      expect(cancelled.state).toBe("cancelled");
      await expectToolErrorAsync(t.callTool("job_cancel", { jobId: "job-nada" }), "NOT_FOUND");
      // Um job vivo é morto no close.
      const other = t.ctx.jobs.start("dorme2", "node", ["-e", "setTimeout(()=>{},30000)"]);
      await t.close();
      expect(t.ctx.jobs.status(other.jobId).state).toBe("cancelled");
    } finally {
      await t.close();
    }
  });
});

/* ========================================================================== */

describe("domínios: init/dispose", () => {
  it("chama init antes do registro e dispose (ordem inversa) + onDispose no close", async () => {
    const calls: string[] = [];
    const mk = (name: string) => ({
      name,
      module: {
        tools: [],
        init: () => {
          calls.push(`init:${name}`);
        },
        dispose: async () => {
          calls.push(`dispose:${name}`);
        },
      },
    });
    const t = await createTestClient({ domains: [mk("a"), mk("b")] });
    t.ctx.onDispose(() => {
      calls.push("onDispose");
    });
    await t.close();
    await t.close();
    expect(calls).toEqual(["init:a", "init:b", "dispose:b", "dispose:a", "onDispose"]);
  });
});

/* ========================================================================== */

describe("stdio (processo real)", () => {
  it("npx tsx tools/mcp/src/server.ts responde initialize + tools/list + engine_ping", async () => {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("ENGINE_MCP_")) env[k] = v;
    env.ENGINE_MCP_LOG = "warn";
    const transport = new StdioClientTransport({
      command: isWindows ? "npx.cmd" : "npx",
      args: ["tsx", "tools/mcp/src/server.ts"],
      cwd: REPO_ROOT,
      env,
      stderr: "pipe",
    });
    let stderr = "";
    transport.stderr?.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    const client = new Client({ name: "stdio-smoke", version: "0.0.0" });
    try {
      await client.connect(transport);
      expect(client.getServerVersion()).toMatchObject({ name: "engine-mcp" });
      const { tools } = await client.listTools();
      expect(tools.map((x) => x.name)).toEqual(expect.arrayContaining(["engine_ping", "job_list", "job_status", "job_log", "job_cancel"]));
      const ping = await client.callTool({ name: "engine_ping", arguments: {} });
      expect(ping.structuredContent).toMatchObject({ ok: true, root: createRepoPaths(REPO_ROOT).root });
    } finally {
      await client.close();
    }
    expect(stderr).not.toMatch(/falha ao iniciar/);
  }, 60_000);
});
