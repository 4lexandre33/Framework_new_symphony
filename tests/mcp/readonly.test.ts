// @vitest-environment node
/**
 * ENGINE_MCP_READONLY=1 (SPEC §1.2): o registry recusa com READONLY toda tool
 * que grava arquivos OU roda processos que podem gravar (gates/testes/build/
 * launch), antes de `run`. Tools de leitura e gates que só leem continuam.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../../tools/mcp/src/core/context.ts";
import { effectiveReadonlyPolicy, readonlyDenial, type ToolDef } from "../../tools/mcp/src/core/registry.ts";
import { gateReadonlyDenial, GATES, READONLY_SAFE_GATES } from "../../tools/mcp/src/gates/definitions.ts";
import { allTools } from "../../tools/mcp/src/tools/index.ts";
import { configureRuntime } from "../../tools/mcp/src/tools/runtime.ts";
import { createTestClient, makeTempRepo, ToolCallError, type TempRepo, type TestClient } from "./harness.ts";

/** Sempre permitidas em modo somente leitura. */
const ALLOWED = [
  "engine_ping", "engine_info", "docs_index", "docs_read", "docs_search", "module_api", "gaps_list", "recipes_list", "recipe_read",
  "project_list", "project_files", "project_read_file",
  "gate_result",
  "job_list", "job_status", "job_log", "job_cancel",
  // runtime: só mexe no jogo em memória (ou abre o WebSocket local), nunca no repositório
  "runtime_connect_info", "runtime_status", "runtime_stop", "kernel_inspect", "loop_control", "world_entities", "world_entity",
  "world_spawn", "world_despawn", "world_patch", "world_snapshot", "physics_raycast", "physics_stats", "camera_get", "camera_set",
  "input_send", "events_subscribe", "events_tail", "commands_send", "logs_tail", "screenshot", "perf_stats", "storage_slots", "scene_load_live",
  "scene_list", "prefab_list", "scene_read", "prefab_read", "scene_validate",
  "assets_list", "assets_validate", "gltf_inspect",
  "desktop_config_get", "build_artifacts", "steam_config_get", "steam_achievements_check", "steam_appid_check",
].sort();

/** Dependem dos argumentos. */
const CONDITIONAL = ["audit_run", "gate_run", "project_check"].sort();

/** Sempre recusadas. */
const DENIED = [
  "project_create", "project_write_file", "project_report_append", "project_delete",
  "test_run", "runtime_launch",
  "scene_create", "scene_entity_add", "scene_entity_update", "scene_entity_remove", "prefab_create", "prefab_update",
  "asset_import",
  "desktop_config_set", "build_web", "build_desktop", "steam_config_set", "steam_pipeline_prepare",
].sort();

const fakeCtx = (root: string): ToolContext => ({ root }) as unknown as ToolContext;

function byName(name: string): ToolDef {
  const def = allTools().find((t) => t.name === name);
  if (!def) throw new Error(`tool ${name} não existe`);
  return def;
}

describe("readonly: classificação de todas as tools", () => {
  it("toda tool está em exatamente uma lista (decisão explícita para tools novas)", () => {
    const names = allTools().map((t) => t.name).sort();
    expect([...ALLOWED, ...CONDITIONAL, ...DENIED].sort()).toEqual(names);
  });

  it("política efetiva bate com as listas; readOnlyHint=true nunca é recusada", () => {
    const ctx = fakeCtx("/nao-existe");
    for (const def of allTools()) {
      const policy = effectiveReadonlyPolicy(def);
      if (ALLOWED.includes(def.name)) {
        expect(readonlyDenial(def, {}, ctx), def.name).toBeNull();
      } else if (DENIED.includes(def.name)) {
        // `deny` ou função que sempre recusa
        expect(policy === "deny" || typeof policy === "function", def.name).toBe(true);
        expect(readonlyDenial(def, {}, ctx), def.name).toEqual(expect.any(String));
      } else {
        expect(typeof policy, def.name).toBe("function");
      }
      if (def.annotations?.readOnlyHint === true) expect(policy, def.name).toBe("allow");
    }
  });

  it("gate_run: só gates que não gravam", () => {
    expect([...READONLY_SAFE_GATES].sort()).toEqual(["agents", "ai-manual", "arch", "diff-check", "tsc"]);
    const gateRun = byName("gate_run");
    for (const gate of GATES) {
      const reason = readonlyDenial(gateRun, { gate }, fakeCtx("/nao-existe"));
      if ((READONLY_SAFE_GATES as readonly string[]).includes(gate)) expect(reason, gate).toBeNull();
      else expect(reason, gate).toMatch(new RegExp(`gate ${gate}`));
    }
    expect(gateReadonlyDenial("stage90", "/x")).toMatch(/ETAPA90_RUNTIME_SMOKE\.log/);
    expect(gateReadonlyDenial("test", "/x")).toMatch(/node_modules\/\.vite/);
  });

  it("audit_run: stage 90 grava, os demais não; project_check: só steps [tsc]", () => {
    const audit = byName("audit_run");
    const ctx = fakeCtx("/x");
    expect(readonlyDenial(audit, { stage: 90 }, ctx)).toMatch(/stage 90/);
    for (const stage of [71, 80, 89]) expect(readonlyDenial(audit, { stage }, ctx), String(stage)).toBeNull();
    const check = byName("project_check");
    expect(readonlyDenial(check, { id: "x" }, ctx)).toMatch(/isolation, tests/);
    expect(readonlyDenial(check, { id: "x", steps: ["tsc", "tests"] }, ctx)).toMatch(/tests/);
    expect(readonlyDenial(check, { id: "x", steps: ["isolation"] }, ctx)).toMatch(/isolation/);
    expect(readonlyDenial(check, { id: "x", steps: ["tsc"] }, ctx)).toBeNull();
  });

  it("anotações: audit_run e project_check não se dizem somente leitura", () => {
    expect(byName("audit_run").annotations?.readOnlyHint).toBe(false);
    expect(byName("project_check").annotations?.readOnlyHint).toBe(false);
  });
});

describe("readonly: chamadas reais pelo cliente MCP", () => {
  let repo: TempRepo;
  let ro: TestClient;

  const expectReadonly = async (name: string, args: Record<string, unknown>): Promise<void> => {
    const error = await ro.callTool(name, args).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error, `${name} ${JSON.stringify(args)}`).toBeInstanceOf(ToolCallError);
    expect((error as ToolCallError).code, `${name} ${JSON.stringify(args)}`).toBe("READONLY");
    expect((error as ToolCallError).message).toMatch(/ENGINE_MCP_READONLY=1/);
  };
  /** Permitida: pode falhar por outro motivo, nunca por READONLY. */
  const expectNotReadonly = async (name: string, args: Record<string, unknown>): Promise<void> => {
    const error = await ro.callTool(name, args).then(
      () => null,
      (e: unknown) => e,
    );
    if (error !== null) expect((error as ToolCallError).code, `${name} ${JSON.stringify(args)}`).not.toBe("READONLY");
  };

  beforeAll(async () => {
    repo = await makeTempRepo();
    await mkdir(path.join(repo.root, "src/projects/demo"), { recursive: true });
    await writeFile(path.join(repo.root, "src/projects/demo/index.ts"), "export {};\n");
    ro = await createTestClient({ root: repo.root, env: { ENGINE_MCP_READONLY: "1" }, config: { bridgePort: 0 } });
    configureRuntime(ro.ctx, { requestTimeoutMs: 500, playwrightDirs: [] });
  });

  afterAll(async () => {
    await ro?.close();
    await repo?.cleanup();
  });

  it("gate_run recusa build/isolation/test/stage90/cargo/all (síncrono e async) sem criar job", async () => {
    for (const gate of ["build", "isolation", "test", "stage90", "cargo-check", "cargo-test", "all"]) {
      await expectReadonly("gate_run", { gate });
      await expectReadonly("gate_run", { gate, async: true });
    }
    await expectReadonly("gate_run", { gate: "all", continueOnFailure: true });
    expect(ro.ctx.jobs.list()).toHaveLength(0);
  });

  it("gate_run permite os gates de leitura (diff-check roda; o resultado não importa aqui)", async () => {
    await expectNotReadonly("gate_run", { gate: "diff-check" });
    await expectNotReadonly("gate_run", { gate: "agents" });
  });

  it("gate_run agents é recusado se houver lock legado a migrar", async () => {
    await mkdir(path.join(repo.root, "tests"), { recursive: true });
    await writeFile(path.join(repo.root, "tests/.freeze-lock.json"), "{}");
    try {
      await expectReadonly("gate_run", { gate: "agents" });
    } finally {
      await rm(path.join(repo.root, "tests/.freeze-lock.json"), { force: true });
    }
  });

  it("test_run, audit_run 90, build_web, build_desktop e runtime_launch → READONLY", async () => {
    await expectReadonly("test_run", {});
    await expectReadonly("test_run", { files: ["gates.test"] });
    await expectReadonly("audit_run", { stage: 90 });
    await expectReadonly("build_web", { id: "demo" });
    await expectReadonly("build_desktop", { id: "demo" });
    await expectReadonly("runtime_launch", { id: "demo" });
    expect(ro.ctx.jobs.list()).toHaveLength(0);
  });

  it("project_check: padrão e etapas que gravam → READONLY; steps [tsc] passa", async () => {
    await expectReadonly("project_check", { id: "demo" });
    await expectReadonly("project_check", { id: "demo", steps: ["tsc", "isolation"] });
    await expectReadonly("project_check", { id: "demo", steps: ["tests"] });
    await expectNotReadonly("project_check", { id: "nao-existe", steps: ["tsc"] });
  });

  it("escritas de arquivo → READONLY", async () => {
    await expectReadonly("project_create", { id: "novo", name: "Novo" });
    await expectReadonly("project_write_file", { id: "demo", path: "a.ts", content: "x" });
    await expectReadonly("project_delete", { id: "demo", confirm: "demo" });
    await expectReadonly("scene_create", { id: "demo", sceneId: "s", sceneName: "S" });
    await expectReadonly("desktop_config_set", { id: "demo", config: {} });
  });

  it("leituras e runtime continuam (falham por outros motivos, nunca READONLY)", async () => {
    await expectNotReadonly("audit_run", { stage: 71 });
    await expectNotReadonly("project_list", {});
    await expectNotReadonly("job_cancel", { jobId: "job-nao-existe" });
    await expectNotReadonly("runtime_status", {});
    await expectNotReadonly("world_entities", {});
    await expectNotReadonly("commands_send", { command: "game.world.spawn-entity" });
    await expectNotReadonly("runtime_connect_info", { id: "demo" });
    await expectNotReadonly("scene_load_live", { id: "demo", scene: "x" });
  });
});
