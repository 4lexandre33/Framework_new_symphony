// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { JobManager, type JobStartOptions } from "../../tools/mcp/src/core/jobs.ts";
import { escapeVdf, parseVdf, serializeVdf } from "../../tools/mcp/src/core/vdf.ts";
import { createTestClient, makeTempRepo, REPO_ROOT, type TempRepo, type TestClient } from "./harness.ts";

const FIXTURES = path.join(REPO_ROOT, "tests", "mcp", "fixtures", "build");

/* ============================================================================
 * VDF
 * ========================================================================== */

describe("vdf", () => {
  it("serializa com escapes e faz o parse de volta", () => {
    const obj = { AppBuild: { AppID: 1, Desc: 'a "b" \\ c\nd\te', Preview: true, Depots: { "2": "depot.vdf" } } };
    const text = serializeVdf(obj);
    expect(text).toContain('"Desc"\t"a \\"b\\" \\\\ c\\nd\\te"');
    expect(text).toContain('"Preview"\t"1"');
    expect(parseVdf(text)).toEqual({ AppBuild: { AppID: "1", Desc: 'a "b" \\ c\nd\te', Preview: "1", Depots: { "2": "depot.vdf" } } });
  });

  it("parser aceita comentários, tokens sem aspas e condicionais", () => {
    const text = '// c\n"A"\n{\n  key value [$WIN32]\n  "n" { "x" "1" } // fim\n}\n';
    expect(parseVdf(text)).toEqual({ A: { key: "value", n: { x: "1" } } });
  });

  it("parser recusa sintaxe inválida", () => {
    expect(() => parseVdf('"A" { "b" "c"')).toThrow(/faltando/);
    expect(() => parseVdf('"A" "b" }')).toThrow(/inesperado/);
    expect(() => parseVdf('"A" "unterminated')).toThrow(/aspas/);
    expect(() => serializeVdf({ a: Number.NaN })).toThrow();
  });

  it("escapeVdf remove controles", () => {
    expect(escapeVdf("a\u0001\rb")).toBe("ab");
  });
});

/* ============================================================================
 * Tools (repo temporário)
 * ========================================================================== */

async function writeProject(root: string, id: string): Promise<void> {
  const dir = path.join(root, "src", "projects", id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "index.ts"), "export {};\n");
}

describe("build (repo temporário)", () => {
  let repo: TempRepo;
  let t: TestClient;
  const started: Array<{ label: string; cmd: string; args: readonly string[]; env: unknown }> = [];

  beforeAll(async () => {
    repo = await makeTempRepo({ copy: ["scripts/tauri-project-config.mjs", "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml"] });
    await writeProject(repo.root, "demo");
    await writeFile(path.join(repo.root, "steam_appid.txt"), "480");
    t = await createTestClient({ root: repo.root });
    // exec falso: todo job vira um `node -e` inofensivo (o comando pedido é registrado).
    const realStart = JobManager.prototype.start;
    vi.spyOn(t.ctx.jobs, "start").mockImplementation(function (this: JobManager, label: string, cmd: string, args: readonly string[], opts: JobStartOptions = {}) {
      started.push({ label, cmd, args, env: opts.env });
      const fail = args.some((a) => a.includes("fail-demo"));
      return realStart.call(t.ctx.jobs, label, "node", ["-e", fail ? "console.error('boom'); process.exit(3)" : "console.log('ok')"], opts);
    });
  });

  afterAll(async () => {
    await t?.close();
    await repo?.cleanup();
  });

  /* ---- desktop_config_* ------------------------------------------------- */

  it("desktop_config_get sem desktop.json devolve defaults mesclados", async () => {
    const out = await t.callTool("desktop_config_get", { id: "demo" });
    expect(out.exists).toBe(false);
    expect(out.valid).toBe(true);
    expect(out.merged.productName).toBe("demo");
    expect(out.merged.identifier).toBe("com.projeto1.demo");
    expect(out.merged.app.windows[0]).toMatchObject({ decorations: true, alwaysOnTop: false, transparent: false, width: 1280 });
    expect(out.generatedPath).toBe("src-tauri/gen/tauri.project.demo.conf.json");
    expect(out.host.identifier).toBe("com.projeto1.game");
  });

  it("desktop_config_set valida e grava; get lê de volta", async () => {
    const config = { productName: "Demo Game", identifier: "com.exemplo.demo", window: { width: 1600, height: 900 } };
    const dry = await t.callTool("desktop_config_set", { id: "demo", config, dryRun: true });
    expect(dry.written).toBe(false);
    expect(existsSync(path.join(repo.root, "src/projects/demo/desktop.json"))).toBe(false);
    const out = await t.callTool("desktop_config_set", { id: "demo", config });
    expect(out.written).toBe(true);
    expect(JSON.parse(readFileSync(path.join(repo.root, "src/projects/demo/desktop.json"), "utf8"))).toEqual(config);
    const got = await t.callTool("desktop_config_get", { id: "demo" });
    expect(got.desktop).toEqual(config);
    expect(got.merged.app.windows[0]).toMatchObject({ title: "Demo Game", width: 1600, height: 900 });
  });

  it("desktop_config_set recusa identifier do host e chaves desconhecidas", async () => {
    await expect(t.callTool("desktop_config_set", { id: "demo", config: { identifier: "com.projeto1.game" } })).rejects.toMatchObject({
      code: "SCHEMA_INVALID",
      message: expect.stringContaining("identifier do host"),
    });
    await expect(t.callTool("desktop_config_set", { id: "demo", config: { icon: "x.png" } })).rejects.toMatchObject({
      code: "SCHEMA_INVALID",
      message: expect.stringContaining('chave desconhecida "icon"'),
    });
    await expect(t.callTool("desktop_config_set", { id: "demo", config: { window: { url: "http://x" } } })).rejects.toMatchObject({ code: "SCHEMA_INVALID" });
    await expect(t.callTool("desktop_config_set", { id: "nao-existe", config: {} })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(t.callTool("desktop_config_get", { id: "../x" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("desktop_config_get reporta desktop.json inválido", async () => {
    await writeProject(repo.root, "ruim");
    await writeFile(path.join(repo.root, "src/projects/ruim/desktop.json"), JSON.stringify({ identifier: "com.projeto1.game" }));
    const out = await t.callTool("desktop_config_get", { id: "ruim" });
    expect(out.valid).toBe(false);
    expect(out.merged).toBeNull();
    expect(out.error).toMatch(/identifier do host/);
  });

  /* ---- build_web / build_desktop (exec falso) --------------------------- */

  it("build_web devolve jobId com o comando vite e VITE_PROJECT", async () => {
    const out = await t.callTool("build_web", { id: "demo" });
    expect(out.jobId).toMatch(/^job-/);
    expect(out.outDir).toBe("dist/demo");
    const last = started.at(-1)!;
    expect(last.cmd).toBe("npx");
    expect(last.args).toEqual(["vite", "build", "--outDir", "dist/demo", "--emptyOutDir"]);
    expect(last.env).toEqual({ VITE_PROJECT: "demo" });
    await t.ctx.jobs.wait(out.jobId, 10_000);
  });

  it("build_web wait devolve tamanhos dos chunks", async () => {
    const assets = path.join(repo.root, "dist/demo/assets");
    await mkdir(assets, { recursive: true });
    await writeFile(path.join(assets, "index-abc.js"), "console.log('x');\n".repeat(200));
    await writeFile(path.join(assets, "index-abc.css"), "body{}");
    const out = await t.callTool("build_web", { id: "demo", wait: true, timeoutMs: 20_000 });
    expect(out.state).toBe("succeeded");
    expect(out.chunks.map((c: { file: string }) => c.file)).toEqual(["dist/demo/assets/index-abc.js", "dist/demo/assets/index-abc.css"]);
    expect(out.largestChunk.bytes).toBe(3600);
    expect(out.largestChunk.gzipBytes).toBeLessThan(3600);
    expect(out.totalBytes).toBe(3606);
  });

  it("build_web wait com falha vira COMMAND_FAILED; projeto inexistente vira NOT_FOUND", async () => {
    await writeProject(repo.root, "fail-demo");
    const err = await t.callTool("build_web", { id: "fail-demo", wait: true }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "COMMAND_FAILED" });
    expect(JSON.stringify((err as { details: unknown }).details)).toContain("boom");
    await expect(t.callTool("build_web", { id: "sumiu" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("build_desktop sem bundles usa o script --build", async () => {
    const out = await t.callTool("build_desktop", { id: "demo" });
    expect(out.command).toBe("node");
    expect(out.args).toEqual(["scripts/tauri-project-config.mjs", "demo", "--build"]);
    expect(out.configPath).toBe("src-tauri/gen/tauri.project.demo.conf.json");
    expect(started.at(-1)).toMatchObject({ cmd: "node", env: { VITE_PROJECT: "demo" } });
    await t.ctx.jobs.wait(out.jobId, 10_000);
  });

  it("build_desktop com bundles gera a config e chama tauri build --bundles", async () => {
    const out = await t.callTool("build_desktop", { id: "demo", bundles: ["deb", "appimage", "deb"] });
    expect(out.command).toBe("npx");
    expect(out.args).toEqual(["tauri", "build", "--config", "src-tauri/gen/tauri.project.demo.conf.json", "--bundles", "deb,appimage"]);
    const gen = JSON.parse(readFileSync(path.join(repo.root, "src-tauri/gen/tauri.project.demo.conf.json"), "utf8"));
    expect(gen.identifier).toBe("com.exemplo.demo");
    await t.ctx.jobs.wait(out.jobId, 10_000);
  });

  it("build_desktop recusa desktop.json inválido e bundle desconhecido", async () => {
    await expect(t.callTool("build_desktop", { id: "ruim" })).rejects.toMatchObject({ code: "SCHEMA_INVALID" });
    await expect(t.callTool("build_desktop", { id: "demo", bundles: ["dmg"] })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  /* ---- build_artifacts --------------------------------------------------- */

  it("build_artifacts sem pasta de bundle devolve lista vazia; com arquivos, sha256", async () => {
    const empty = await t.callTool("build_artifacts", { id: "demo" });
    expect(empty).toMatchObject({ exists: false, artifacts: [], productName: "Demo Game" });

    const bundle = path.join(repo.root, "src-tauri/target/release/bundle");
    await mkdir(path.join(bundle, "nsis"), { recursive: true });
    await mkdir(path.join(bundle, "deb"), { recursive: true });
    await mkdir(path.join(bundle, "macos/Demo Game.app/Contents"), { recursive: true });
    await writeFile(path.join(bundle, "nsis/Demo Game_0.1.0_x64-setup.exe"), "installer");
    await writeFile(path.join(bundle, "deb/outro_0.1.0_amd64.deb"), "deb!");
    await writeFile(path.join(bundle, "deb/ignorar.txt"), "x");
    await writeFile(path.join(bundle, "macos/Demo Game.app/Contents/Info.plist"), "12345");
    const out = await t.callTool("build_artifacts", { id: "demo" });
    expect(out.exists).toBe(true);
    const byKind = Object.fromEntries(out.artifacts.map((a: { kind: string }) => [a.kind, a]));
    expect(Object.keys(byKind).sort()).toEqual(["app", "deb", "nsis"]);
    expect(byKind.nsis).toMatchObject({
      platform: "windows",
      bytes: 9,
      sha256: createHash("sha256").update("installer").digest("hex"),
      matchesProject: true,
    });
    expect(byKind.deb.matchesProject).toBe(false);
    expect(byKind.app).toMatchObject({ bytes: 5, sha256: null, matchesProject: true });
    await expect(t.callTool("build_artifacts", { id: "sumiu" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  /* ---- steam_config_* --------------------------------------------------- */

  it("steam_config_get sem arquivo; set cria, mescla e valida", async () => {
    expect(await t.callTool("steam_config_get", { id: "demo" })).toMatchObject({ exists: false, valid: false, config: null });
    await expect(t.callTool("steam_config_set", { id: "demo", depots: { windows: 2 } })).rejects.toMatchObject({ code: "SCHEMA_INVALID" });

    const created = await t.callTool("steam_config_set", {
      id: "demo",
      appId: 1234560,
      depots: { windows: 1234561, linux: 1234562 },
      achievements: [{ id: "ACH_FIRST_JUMP", name: "Primeiro pulo" }, { id: "ACH_UNUSED" }],
      stats: [
        { id: "distancia_total", type: "int" },
        { id: "velocidade_max", type: "int" },
      ],
    });
    expect(created.created).toBe(true);
    const merged = await t.callTool("steam_config_set", { id: "demo", stats: [...created.config.stats, { id: "nunca_usada", type: "float" }] });
    expect(merged.created).toBe(false);
    expect(merged.config.appId).toBe(1234560);
    expect(merged.config.achievements).toHaveLength(2);
    const got = await t.callTool("steam_config_get", { id: "demo" });
    expect(got.valid).toBe(true);
    expect(got.config.stats).toHaveLength(3);

    await expect(t.callTool("steam_config_set", { id: "demo", achievements: [{ id: "A" }, { id: "A" }] })).rejects.toMatchObject({
      code: "SCHEMA_INVALID",
      message: expect.stringContaining("id repetido"),
    });
    await expect(t.callTool("steam_config_set", { id: "demo", achievements: [{ id: "com espaço" }] })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(t.callTool("steam_config_set", { id: "demo", password: "x" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const w = await t.callTool("steam_config_set", { id: "ruim", appId: 480, replace: true });
    expect(w.warnings.join(" ")).toMatch(/Spacewar/);
  });

  it("steam_config_get reporta steam.json inválido", async () => {
    await writeProject(repo.root, "steam-ruim");
    await writeFile(path.join(repo.root, "src/projects/steam-ruim/steam.json"), JSON.stringify({ appId: "x" }));
    const out = await t.callTool("steam_config_get", { id: "steam-ruim" });
    expect(out.valid).toBe(false);
    expect(out.errors.length).toBeGreaterThan(0);
    await expect(t.callTool("steam_achievements_check", { id: "steam-ruim" })).rejects.toMatchObject({ code: "SCHEMA_INVALID" });
    await expect(t.callTool("steam_pipeline_prepare", { id: "steam-ruim" })).rejects.toMatchObject({ code: "SCHEMA_INVALID" });
  });

  /* ---- steam_achievements_check ----------------------------------------- */

  it("steam_achievements_check compara código × steam.json", async () => {
    const src = path.join(FIXTURES, "game-src");
    for (const f of await readdir(src)) {
      await writeFile(path.join(repo.root, "src/projects/demo", f.replace(/\.txt$/u, "")), readFileSync(path.join(src, f)));
    }
    const out = await t.callTool("steam_achievements_check", { id: "demo" });
    expect(out.filesScanned).toBe(2); // index.ts + Achievements.ts
    expect(out.used.achievements.map((u: { id: string }) => u.id).sort()).toEqual(["ACH_BY_COMMAND", "ACH_FIRST_JUMP", "ACH_SECRET_ROOM"]);
    expect(out.usedButUndeclared).toEqual({ achievements: ["ACH_BY_COMMAND", "ACH_SECRET_ROOM"], stats: ["tempo_jogo"] });
    expect(out.declaredButUnused).toEqual({ achievements: ["ACH_UNUSED"], stats: ["nunca_usada"] });
    expect(out.typeMismatches).toEqual([expect.objectContaining({ id: "velocidade_max", declared: "int", used: "float", line: 10 })]);
    expect(out.dynamicCalls).toEqual([expect.objectContaining({ method: "unlockAchievement", expression: "`ACH_${name}`" })]);
    expect(out.ok).toBe(false);

    const withTests = await t.callTool("steam_achievements_check", { id: "demo", includeTests: true });
    expect(withTests.usedButUndeclared.achievements).toContain("ACH_ONLY_IN_TESTS");
    await expect(t.callTool("steam_achievements_check", { id: "sumiu" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  /* ---- steam_pipeline_prepare ------------------------------------------- */

  it("steam_pipeline_prepare gera VDFs iguais às fixtures", async () => {
    const out = await t.callTool("steam_pipeline_prepare", { id: "demo", branch: "beta", description: 'Build "teste" \\ v1' });
    expect(out.appBuild).toBe("src-tauri/gen/steam/demo/app_build_1234560.vdf");
    expect(out.setLive).toBe("beta");
    expect(out.command).toBe(`steamcmd +login <usuario> +run_app_build "${path.join(repo.root, "src-tauri/gen/steam/demo/app_build_1234560.vdf")}" +quit`);
    expect(out.depots.map((d: { platform: string }) => d.platform)).toEqual(["windows", "linux"]);
    expect(out.depots[0].contentExists).toBe(true); // bundle/nsis criado acima
    expect(out.depots[1].contentExists).toBe(false);
    expect(out.warnings.join("\n")).toMatch(/appimage.*não existe/);
    const root = escapeVdf(repo.root);
    for (const file of ["app_build_1234560.vdf", "depot_build_1234561.vdf", "depot_build_1234562.vdf"]) {
      const expected = readFileSync(path.join(FIXTURES, file), "utf8").replaceAll("{{ROOT}}", root);
      const actual = readFileSync(path.join(repo.root, "src-tauri/gen/steam/demo", file), "utf8");
      expect(actual).toBe(expected);
      expect(() => parseVdf(actual)).not.toThrow();
    }
    expect(parseVdf(readFileSync(path.join(repo.root, out.appBuild), "utf8"))).toMatchObject({ AppBuild: { Desc: 'Build "teste" \\ v1' } });
    expect(JSON.stringify(out)).not.toMatch(/password|senha=/i);
  });

  it("steam_pipeline_prepare: branch default sem SetLive, plataformas filtradas, preview", async () => {
    const out = await t.callTool("steam_pipeline_prepare", { id: "demo", branch: "default", platforms: ["linux"], preview: true });
    expect(out.setLive).toBeNull();
    expect(out.depots).toHaveLength(1);
    const app = parseVdf(readFileSync(path.join(repo.root, out.appBuild), "utf8")) as { AppBuild: Record<string, unknown> };
    expect(app.AppBuild.SetLive).toBeUndefined();
    expect(app.AppBuild.Preview).toBe("1");
    expect(app.AppBuild.Depots).toEqual({ "1234562": "depot_build_1234562.vdf" });
  });

  it("steam_pipeline_prepare: erros", async () => {
    await expect(t.callTool("steam_pipeline_prepare", { id: "demo", platforms: ["macos"] })).rejects.toMatchObject({ code: "SCHEMA_INVALID" });
    await expect(t.callTool("steam_pipeline_prepare", { id: "fail-demo" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(t.callTool("steam_pipeline_prepare", { id: "demo", branch: "a b" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(t.callTool("steam_pipeline_prepare", { id: "demo", contentRoots: { linux: "../../etc" } })).rejects.toMatchObject({ code: "PATH_OUTSIDE_REPO" });
  });

  /* ---- steam_appid_check ------------------------------------------------- */

  it("steam_appid_check lê appid, feature Cargo e redistribuível", async () => {
    await mkdir(path.join(repo.root, "src-tauri/target/release/build/steamworks-sys-abc/out"), { recursive: true });
    await writeFile(path.join(repo.root, "src-tauri/target/release/build/steamworks-sys-abc/out/libsteam_api.so"), "elf");
    const out = await t.callTool("steam_appid_check", { id: "demo" });
    expect(out.appIdFiles[0]).toMatchObject({ path: "steam_appid.txt", exists: true, appId: 480, valid: true });
    expect(out.appIdFiles[1]).toMatchObject({ path: "src-tauri/steam_appid.txt", exists: false });
    expect(out.cargo).toMatchObject({ cargoTomlExists: true, steamFeatureDeclared: true, steamInDefault: true });
    expect(out.cargo.steamworksDependency).toMatch(/optional = true/);
    expect(out.redistributables).toEqual([
      { name: "libsteam_api.so", platform: "linux", path: "src-tauri/target/release/build/steamworks-sys-abc/out/libsteam_api.so", bytes: 3 },
    ]);
    expect(out.missingRedistributables.map((m: { name: string }) => m.name)).toEqual(["steam_api64.dll", "libsteam_api.dylib"]);
    expect(out.projectAppId).toBe(1234560);
    expect(out.warnings.join("\n")).toMatch(/appId 1234560/);
    await expect(t.callTool("steam_appid_check", { id: "sumiu" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("steam_appid_check sem arquivos avisa", async () => {
    const bare = await makeTempRepo();
    const t2 = await createTestClient({ root: bare.root });
    try {
      const out = await t2.callTool("steam_appid_check");
      expect(out.cargo.cargoTomlExists).toBe(false);
      expect(out.warnings.join("\n")).toMatch(/nenhum steam_appid/);
    } finally {
      await t2.close();
      await bare.cleanup();
    }
  });

  it("READONLY recusa escritas", async () => {
    const t2 = await createTestClient({ root: repo.root, config: { readonly: true } });
    try {
      await expect(t2.callTool("desktop_config_set", { id: "demo", config: {} })).rejects.toMatchObject({ code: "READONLY" });
      await expect(t2.callTool("steam_pipeline_prepare", { id: "demo" })).rejects.toMatchObject({ code: "READONLY" });
    } finally {
      await t2.close();
    }
  });
});

/* ============================================================================
 * Build web real (physics-sandbox) — ~10 s numa máquina comum
 * ========================================================================== */

describe("build_web real", () => {
  it("vite build do physics-sandbox com wait devolve chunks", async () => {
    const t = await createTestClient();
    try {
      const out = await t.callTool("build_web", { id: "physics-sandbox", wait: true, timeoutMs: 170_000 });
      expect(out.state).toBe("succeeded");
      expect(out.chunks.some((c: { file: string }) => /^dist\/physics-sandbox\/assets\/index-.*\.js$/u.test(c.file))).toBe(true);
      expect(out.totalBytes).toBeGreaterThan(100_000);
    } finally {
      await t.close();
    }
  }, 180_000);
});
