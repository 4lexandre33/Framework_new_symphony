/**
 * T4 — gates: parsers sobre saídas reais gravadas (tests/mcp/fixtures/gates)
 * e tools gate_run / gate_result / test_run / audit_run pelo cliente MCP.
 */

import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { McpToolError } from "../../tools/mcp/src/core/errors.ts";
import { Executor } from "../../tools/mcp/src/core/exec.ts";
import {
  normalizeAuditJson,
  parseAgents,
  parseArch,
  parseCargo,
  parseComposite,
  parseDiffCheck,
  parseLayer1Audit,
  parseTsc,
  parseVitestJson,
  parseVitestText,
  relativizePath,
  stripAnsi,
  tailText,
} from "../../tools/mcp/src/core/parsers.ts";
import { createRepoPaths } from "../../tools/mcp/src/core/paths.ts";
import { ALL_ORDER, extractGateResult, findAuditScript, gateCommand, RESULT_MARKER, runSingleGate } from "../../tools/mcp/src/gates/definitions.ts";
import { createTestClient, HAS_GIT, makeTempRepo, REPO_ROOT, type TempRepo, type TestClient } from "./harness.ts";

const FIX = path.join(REPO_ROOT, "tests", "mcp", "fixtures", "gates");
const fx = (name: string): string => readFileSync(path.join(FIX, name), "utf8");

/* ========================================================================== */

describe("parsers (fixtures reais e amostras de falha)", () => {
  it("utilitários: ANSI, caminhos relativos, tail", () => {
    expect(stripAnsi("\x1b[31m[ERRO]\x1b[0m x")).toBe("[ERRO] x");
    expect(relativizePath("/repo/src/a.ts", "/repo")).toBe("src/a.ts");
    expect(relativizePath("file:///repo/src/a.ts", "/repo")).toBe("src/a.ts");
    expect(relativizePath("src\\a\\b.ts")).toBe("src/a/b.ts");
    expect(relativizePath("./x.ts")).toBe("x.ts");
    const long = Array.from({ length: 2000 }, (_, i) => `linha ${i}`).join("\n");
    const t = tailText(long, 100);
    expect(t.length).toBeLessThanOrEqual(100);
    expect(t.endsWith("linha 1999")).toBe(true);
    expect(t.startsWith("linha")).toBe(true);
  });

  it("tsc: saída real com 4 erros (arquivo, linha, coluna, código)", () => {
    const f = parseTsc(fx("tsc-fail.txt"));
    expect(f).toHaveLength(4);
    expect(f[0]).toEqual({ file: "src/bad.ts", line: 1, column: 7, code: "TS2322", message: "Type 'string' is not assignable to type 'number'." });
    expect(f.map((x) => x.code)).toEqual(["TS2322", "TS6133", "TS2339", "TS2307"]);
  });

  it("tsc: continuação indentada, caminho absoluto/Windows e erro global", () => {
    const f = parseTsc(fx("tsc-multiline.txt"), "/repo");
    expect(f).toHaveLength(3);
    expect(f[0]!.file).toBe("src/projects/demo/main.ts");
    expect(f[0]!.message).toContain("\nProperty 'y' is missing");
    expect(f[1]).toMatchObject({ file: "src/engine/world/public/index.ts", line: 3, column: 1, code: "TS1128" });
    expect(f[2]).toMatchObject({ file: "tsconfig", code: "TS5083" });
  });

  it("arch:check: saída real aprovada não gera falhas; violação real de boundary", () => {
    expect(parseArch(fx("arch-ok.txt"))).toEqual([]);
    const f = parseArch(fx("arch-fail.txt"), "/repo");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ file: "src/engine/render/internal/ZzzGateFixture.ts", line: 1, column: 30, code: "BND001" });
    expect(f[0]!.message).toContain("não pode importar implementação internal de engine/physics");
    expect(f[0]!.message).toContain("destino: src/engine/physics/internal/PhysicsWorld.ts");
  });

  it("arch:check: grafo de dependências e etapa não concluída", () => {
    const f = parseArch(fx("deps-fail.txt"), "/repo");
    expect(f.map((x) => x.code)).toEqual(["DEP003", "DEP007", "ARCH_ERROR"]);
    expect(f[0]).toMatchObject({ file: "src/plugins/physics/index.ts" });
    expect(f[0]!.message).toContain("plugin game.physics");
    expect(f[0]!.message).not.toContain("detalhes:");
    expect(f[2]!.message).toContain("TypeScript Compiler API ausente");
  });

  it("agents.mjs: aprovado (real) e reprovado por freeze-lock (real, com ANSI)", () => {
    expect(parseAgents(fx("agents-ok.txt"))).toEqual([]);
    const f = parseAgents(fx("agents-fail.txt"), "/repo");
    expect(f).toEqual([
      { file: "src/engine/render/internal/ZzzGateFixture.ts", code: "FREEZE_DRIFT", message: "Arquivo canônico não está no lock" },
      { file: "src/contracts/ai/types.ts", code: "FREEZE_CHANGED", message: "arquivo congelado foi alterado (freeze-lock)" },
    ]);
    const inv = parseAgents("\x1b[31m[FALHA NAS INVARIANTES]\x1b[0m Foram encontradas quebras:\n  - \x1b[31msrc/engine/x/public/index.ts exporta internal\x1b[0m\n\nfim");
    expect(inv).toEqual([{ file: "src/engine/x/public/index.ts", code: "INVARIANT", message: "src/engine/x/public/index.ts exporta internal" }]);
  });

  it("auditorias Layer-1: saídas reais aprovadas (71, 83, 86, 89) sem violações", () => {
    for (const n of ["71", "83", "86", "89"]) expect(parseLayer1Audit(fx(`audit${n}-ok.txt`))).toEqual([]);
  });

  it("auditorias Layer-1: todos os formatos de violação", () => {
    const f = parseLayer1Audit(fx("layer1-fail.txt"), "/repo");
    expect(f).toEqual([
      { file: "src/engine/net/internal/WebSocketTransport.ts", code: "NET008", message: "socket não é fechado no dispose" },
      { file: "src-tauri/src/lib.rs", line: 42, code: "TAURI_CMD_UNKNOWN", message: "comando nativo fora da allowlist" },
      { file: "(auditoria)", code: "references.resolve", message: "2 caminho(s) quebrado(s)" },
      { file: "src/engine/render/internal/ThreeRenderEngine.ts", code: "render.dispose", message: "verificação render.dispose falhou" },
      { file: "docs/layer1/README.md", code: "DOC_REF_MISSING", message: "caminho citado não existe: src/engine/foo.ts" },
      { file: "src/engine/game-loop/internal/GameLoop.ts", line: 120, code: "GL004", message: "allocation no hot path" },
    ]);
  });

  it("auditorias Layer-1: --json (code/rule, scope/path/file, linha no scope)", () => {
    const r = normalizeAuditJson(JSON.parse(fx("audit-fail.json")), "/repo");
    expect(r.ok).toBe(false);
    expect(r.failures).toEqual([
      { file: "src/engine/net/internal/WebSocketTransport.ts", code: "NET008", message: "socket não é fechado no dispose" },
      { file: "src/engine/world/public/index.ts", line: 7, code: "L1_BASELINE_DRIFT", message: "API pública mudou sem recertificação" },
      { file: "src/engine/render/internal/ThreeRenderEngine.ts", line: 88, code: "PERF001", message: "alocação por frame" },
    ]);
    expect(normalizeAuditJson({ ok: true, violations: [] })).toEqual({ ok: true, failures: [] });
  });

  it("vitest JSON (real): por arquivo/teste, erro de suíte, linha da falha", () => {
    const r = parseVitestJson(fx("vitest-mixed.json"), "/repo");
    expect(r.success).toBe(false);
    expect(r.counts).toMatchObject({ files: 2, failedFiles: 2, passed: 1, failed: 1, skipped: 1 });
    const broken = r.files.find((f) => f.file === "tests/broken.test.ts")!;
    expect(broken.status).toBe("failed");
    expect(broken.message).toContain("Failed to load url ./nao-existe");
    const sample = r.files.find((f) => f.file === "tests/sample.test.ts")!;
    expect(sample.tests.map((t) => [t.name, t.status])).toEqual([
      ["passa", "passed"],
      ["falha", "failed"],
      ["pulado", "skipped"],
    ]);
    const failed = sample.tests[1]!;
    expect(failed).toMatchObject({ fullName: "grupo falha", ancestors: ["grupo"], line: 5, column: 22 });
    expect(failed.failureMessages![0]).toContain("expected { a: 1 } to deeply equal { a: 2 }");
    expect(r.failures).toEqual([
      expect.objectContaining({ file: "tests/broken.test.ts", code: "SUITE_FAILED" }),
      { file: "tests/sample.test.ts", line: 5, column: 22, code: "TEST_FAILED", message: "grupo falha: AssertionError: expected { a: 1 } to deeply equal { a: 2 }" },
    ]);
  });

  it("vitest texto + compostos reais (project:isolation, stage90)", () => {
    expect(parseVitestText(" FAIL  tests/a.test.ts > s > t\n FAIL  tests/a.test.ts > s > t")).toEqual([
      { file: "tests/a.test.ts", code: "TEST_FAILED", message: "s > t" },
    ]);
    const iso = parseComposite(fx("isolation-fail.txt"), "npm run project:isolation", "/repo");
    expect(iso[0]).toMatchObject({ file: "tests/mcp/core.test.ts", code: "TEST_FAILED" });
    expect(iso.some((f) => f.code === "STEP_FAILED" && f.message.includes("VITEST falhou"))).toBe(true);
    const s90 = parseComposite(fx("stage90-fail.txt"), "npm run stage90:validate", "/repo");
    expect(s90).toEqual([expect.objectContaining({ code: "ERROR", message: expect.stringContaining("Binário release ausente") })]);
  });

  it("cargo check/test: error[E…] --> arquivo:linha:col (relativo a src-tauri) e testes com panic", () => {
    const c = parseCargo(fx("cargo-check-fail.txt"), { root: "/repo" });
    expect(c).toEqual([
      { file: "src-tauri/src/lib.rs", line: 10, column: 5, code: "E0425", message: "cannot find value `nao_existe` in this scope" },
      { file: "src-tauri/src/security.rs", line: 120, column: 17, code: "E0308", message: "mismatched types" },
    ]);
    const t = parseCargo(fx("cargo-test-fail.txt"), { root: "/repo" });
    expect(t).toEqual([
      { file: "src-tauri/src/security.rs", line: 210, column: 9, code: "TEST_FAILED", message: "teste security::tests::recusa_origem_externa falhou: assertion `left == right` failed" },
      { file: "src-tauri", code: "TEST_FAILED", message: "teste steam::tests::sem_steam falhou" },
    ]);
    expect(parseCargo("error: linker `cc` not found\n")).toEqual([{ file: "src-tauri", message: "linker `cc` not found" }]);
  });

  it("git diff --check", () => {
    const text = fx("diffcheck-fail.txt").replace(/<TRAILING>/g, "   ").replace(/<TAB>/g, "\t");
    expect(parseDiffCheck(text)).toEqual([
      { file: "src/projects/demo/main.ts", line: 3, code: "WHITESPACE", message: "trailing whitespace" },
      { file: "docs/games/demo/README.md", line: 10, code: "WHITESPACE", message: "space before tab in indent" },
      { file: "src/projects/demo/main.ts", line: 20, code: "WHITESPACE", message: "leftover conflict marker" },
    ]);
  });

  it("resultado do job: última linha marcada (ou erro)", () => {
    const log = `saída\n${RESULT_MARKER} {"gate":"tsc","ok":false}\nmais\n${RESULT_MARKER} {"gate":"tsc","ok":true}\n`;
    expect(extractGateResult(log)?.result).toMatchObject({ gate: "tsc", ok: true });
    expect(extractGateResult(`${RESULT_MARKER} {"error":{"code":"COMMAND_FAILED","message":"x"}}`)?.error?.code).toBe("COMMAND_FAILED");
    expect(extractGateResult("sem marcador")).toBeNull();
  });

  it("findAuditScript acha audit 71..89 e validate no 90", () => {
    expect(findAuditScript(REPO_ROOT, 83)).toBe("scripts/architecture/stage83-audit-networking.mjs");
    expect(findAuditScript(REPO_ROOT, 90)).toBe("scripts/architecture/stage90-validate-layer1-gate.mjs");
    expect(findAuditScript(REPO_ROOT, 12)).toBeNull();
    expect(gateCommand("cargo-check")).toBe("(cd src-tauri && cargo check)");
    expect(ALL_ORDER).toHaveLength(11);
  });
});

/* ========================================================================== */

describe("gate_run / gate_result (repo real)", () => {
  let t: TestClient;
  beforeAll(async () => {
    t = await createTestClient();
  });
  afterAll(async () => {
    await t.close();
  });

  it("lista as tools do domínio com descrições", async () => {
    const names = (await t.listTools()).map((x) => x.name);
    for (const n of ["gate_run", "gate_result", "test_run", "audit_run"]) expect(names).toContain(n);
  });

  it("gate desconhecido e continueOnFailure fora do all: INVALID_INPUT", async () => {
    await expect(t.callTool("gate_run", { gate: "lint" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(t.callTool("gate_run", { gate: "tsc", continueOnFailure: true })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(t.callTool("gate_run", { gate: "tsc", extra: 1 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("tsc real passa (com notificações de progresso)", async () => {
    const progress: string[] = [];
    const raw = await t.client.callTool({ name: "gate_run", arguments: { gate: "tsc" } }, undefined, {
      onprogress: (p) => progress.push(p.message ?? ""),
      timeout: 600_000,
    });
    const out = raw.structuredContent as { ok: boolean; gate: string; failures: unknown[]; async: boolean; command: string; summary: string };
    expect(raw.isError).toBeFalsy();
    expect(out).toMatchObject({ ok: true, gate: "tsc", async: false, failures: [], command: "npx tsc --noEmit -p ." });
    expect(out.summary).toBe("tsc: ok");
    expect(progress.length).toBeGreaterThan(0);
    expect(progress[0]).toContain("tsc");
  }, 600_000);

  it.skipIf(!HAS_GIT)("diff-check como job: jobId → job termina → gate_result estruturado", async () => {
    const started = await t.callTool("gate_run", { gate: "diff-check", async: true });
    expect(started).toMatchObject({ async: true, gate: "diff-check", command: "git diff --check" });
    expect(started.jobId).toMatch(/^job-/);
    const early = await t.callTool("gate_result", { jobId: started.jobId });
    expect(early.jobId).toBe(started.jobId);
    const info = await t.ctx.jobs.wait(started.jobId, 120_000);
    expect(info.state).toBe("succeeded");
    const res = await t.callTool("gate_result", { jobId: started.jobId });
    expect(res).toMatchObject({ state: "succeeded", done: true, result: { gate: "diff-check", ok: true, failures: [], exitCode: 0 } });
    const log = await t.callTool("job_log", { jobId: started.jobId });
    expect(log.text).toContain(RESULT_MARKER);
  }, 180_000);

  it("cancelar a chamada síncrona mata o processo do gate", async () => {
    const controller = new AbortController();
    const call = t.client.callTool({ name: "gate_run", arguments: { gate: "tsc" } }, undefined, { signal: controller.signal, timeout: 120_000 });
    await new Promise((r) => setTimeout(r, 800));
    expect(t.ctx.exec.running).toBeGreaterThan(0);
    controller.abort();
    await expect(call).rejects.toThrow();
    const deadline = Date.now() + 15_000;
    while (t.ctx.exec.running > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    expect(t.ctx.exec.running).toBe(0);
  }, 60_000);

  it("job de gate cancelado: gate_result devolve done sem resultado", async () => {
    const started = await t.callTool("gate_run", { gate: "tsc", async: true });
    await new Promise((r) => setTimeout(r, 1500));
    const cancelled = await t.callTool("job_cancel", { jobId: started.jobId });
    expect(cancelled.state).toBe("cancelled");
    const res = await t.callTool("gate_result", { jobId: started.jobId });
    expect(res).toMatchObject({ state: "cancelled", done: true });
    expect(res.result).toBeUndefined();
  }, 60_000);

  it("gate_result: job inexistente NOT_FOUND; job que não é de gate INVALID_INPUT", async () => {
    await expect(t.callTool("gate_result", { jobId: "job-nao-existe" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const other = t.ctx.jobs.start("outro job", "node", ["-e", "0"]);
    await t.ctx.jobs.wait(other.jobId, 10_000);
    await expect(t.callTool("gate_result", { jobId: other.jobId })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("cargo ausente no PATH vira COMMAND_FAILED com dica", async () => {
    const exec = new Executor(createRepoPaths(REPO_ROOT));
    const err = await runSingleGate({ root: REPO_ROOT, exec }, "cargo-check", { env: { PATH: "/caminho/inexistente" } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(McpToolError);
    expect(err).toMatchObject({ code: "COMMAND_FAILED" });
    expect((err as McpToolError).hint).toContain("rustup");
  });
});

/* ========================================================================== */

describe("gate_run em repositório temporário (falhas de verdade)", () => {
  let repo: TempRepo;
  let t: TestClient;
  beforeAll(async () => {
    repo = await makeTempRepo();
    // agents.mjs falso que reproduz a saída real reprovada.
    const sample = JSON.stringify(fx("agents-fail.txt"));
    await writeFile(path.join(repo.root, "agents.mjs"), `process.stdout.write(${sample});\nprocess.exit(1);\n`);
    t = await createTestClient({ root: repo.root });
  });
  afterAll(async () => {
    await t.close();
    await repo.cleanup();
  });

  it("agents reprovado: ok=false com failures estruturadas e tail", async () => {
    const out = await t.callTool("gate_run", { gate: "agents" });
    expect(out).toMatchObject({ ok: false, gate: "agents", exitCode: 1, failureCount: 2 });
    expect(out.failures[1]).toEqual({ file: "src/contracts/ai/types.ts", code: "FREEZE_CHANGED", message: "arquivo congelado foi alterado (freeze-lock)" });
    expect(out.summary).toMatch(/^agents: 2 falha\(s\)/);
    expect(out.tail).toContain("EXECUÇÃO BLOQUEADA");
  }, 60_000);

  it("all para no primeiro reprovado (diff-check fora de um repo git) e lista os que não rodaram", async () => {
    const out = await t.callTool("gate_run", { gate: "all" });
    expect(out.ok).toBe(false);
    expect(out.steps).toHaveLength(1);
    expect(out.steps[0]).toMatchObject({ gate: "diff-check", ok: false });
    expect(out.skipped).toEqual(ALL_ORDER.slice(1));
    expect(out.summary).toContain("diff-check");
  }, 60_000);

  it("cargo-check sem src-tauri: NOT_FOUND", async () => {
    await expect(t.callTool("gate_run", { gate: "cargo-check" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("audit_run sem scripts de auditoria: NOT_FOUND", async () => {
    await expect(t.callTool("audit_run", { stage: 75 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

/* ========================================================================== */

describe("test_run e audit_run (repo real)", () => {
  let t: TestClient;
  beforeAll(async () => {
    t = await createTestClient();
  });
  afterAll(async () => {
    await t.close();
  });

  it("test_run com arquivo + namePattern: resultados por teste", async () => {
    const out = await t.callTool("test_run", { files: ["tests/mcp/core.test.ts"], namePattern: "validateProjectId" });
    expect(out.ok).toBe(true);
    expect(out.counts.passed).toBe(1);
    const file = out.files.find((f: { file: string }) => f.file === "tests/mcp/core.test.ts");
    expect(file).toBeDefined();
    const passed = file.tests.filter((x: { status: string }) => x.status === "passed");
    expect(passed.map((x: { name: string }) => x.name)).toEqual(["validateProjectId e projectDir"]);
    expect(out.command).toContain("--testNamePattern=validateProjectId");
  }, 300_000);

  it("test_run: arquivo inexistente, fora do repo, opção e regex inválida", async () => {
    await expect(t.callTool("test_run", { files: ["tests/nao-existe.test.ts"] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(t.callTool("test_run", { files: ["../fora.test.ts"] })).rejects.toMatchObject({ code: "PATH_OUTSIDE_REPO" });
    await expect(t.callTool("test_run", { files: ["--reporter=verbose"] })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(t.callTool("test_run", { namePattern: "(" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("audit_run 71 (--json) e 89 (texto) aprovam no repo", async () => {
    const a = await t.callTool("audit_run", { stage: 71 });
    expect(a).toMatchObject({ ok: true, stage: 71, format: "json", violations: [], script: "scripts/architecture/stage71-audit-layer1-baseline.mjs" });
    const b = await t.callTool("audit_run", { stage: 89 });
    expect(b).toMatchObject({ ok: true, stage: 89, format: "text", violations: [] });
    expect(b.tail).toContain("0 violations");
  }, 120_000);

  it("audit_run fora de 71..90: INVALID_INPUT", async () => {
    await expect(t.callTool("audit_run", { stage: 70 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(t.callTool("audit_run", { stage: 91 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
