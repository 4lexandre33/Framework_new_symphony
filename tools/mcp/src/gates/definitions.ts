/**
 * Definição e execução dos gates do repositório (T4 — SPEC §3.3).
 *
 * Usado de dois jeitos:
 * - síncrono, dentro da tool `gate_run` (com progresso e cancelamento);
 * - assíncrono, pelo `runner.ts` rodando como job (`node --import tsx runner.ts`),
 *   que imprime o resultado final numa linha `@@ENGINE_GATE_RESULT@@ {json}`.
 *
 * Todo processo passa pelo `Executor` (allowlist de core/exec).
 */

import { randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { McpToolError } from "../core/errors.ts";
import { TailBuffer, type Executor } from "../core/exec.ts";
import {
  dedupeFailures,
  normalizeAuditJson,
  parseAgents,
  parseArch,
  parseCargo,
  parseComposite,
  parseDiffCheck,
  parseGenericErrors,
  parseLayer1Audit,
  parseTsc,
  parseVitestJson,
  tailText,
  type GateFailure,
  type VitestReport,
} from "../core/parsers.ts";

export const SINGLE_GATES = [
  "tsc",
  "test",
  "arch",
  "isolation",
  "agents",
  "stage90",
  "ai-manual",
  "build",
  "cargo-check",
  "cargo-test",
  "diff-check",
] as const;
export type SingleGate = (typeof SINGLE_GATES)[number];
export const GATES = [...SINGLE_GATES, "all"] as const;
export type GateName = (typeof GATES)[number];

/** Ordem do gate `all`: rápidos primeiro. */
export const ALL_ORDER: readonly SingleGate[] = [
  "diff-check",
  "tsc",
  "arch",
  "agents",
  "ai-manual",
  "test",
  "isolation",
  "build",
  "stage90",
  "cargo-check",
  "cargo-test",
];

export const RESULT_MARKER = "@@ENGINE_GATE_RESULT@@";
export const MAX_FAILURES = 200;
export const TAIL_CHARS = 4000;
const OUTPUT_LIMIT = 2 * 1024 * 1024;

export interface GateStepResult {
  gate: SingleGate;
  ok: boolean;
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  summary: string;
  failures: GateFailure[];
  /** Total antes do corte em `MAX_FAILURES`. */
  failureCount: number;
  tail: string;
}

export interface GateRunResult extends Omit<GateStepResult, "gate" | "command" | "exitCode"> {
  gate: GateName;
  command: string;
  exitCode: number | null;
  /** Só no gate `all`. */
  steps?: GateStepResult[];
  /** Gates do `all` que não rodaram (parou na primeira falha). */
  skipped?: SingleGate[];
}

export interface GateEnv {
  readonly root: string;
  readonly exec: Executor;
}

export interface GateRunOptions {
  readonly signal?: AbortSignal;
  /** Chamado a cada linha de saída (para progresso/streaming). */
  readonly onOutput?: (chunk: Buffer) => void;
  /** Início/fim de cada gate (útil no `all`). */
  readonly onStep?: (event: { gate: SingleGate; index: number; total: number; phase: "start" | "end"; result?: GateStepResult }) => void;
  readonly continueOnFailure?: boolean;
  /** Variáveis extras (testes: simular PATH sem cargo). */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Sobrescreve o timeout padrão de cada gate (ms). */
  readonly timeoutMs?: number;
}

interface GateSpec {
  readonly cmd: "npm" | "npx" | "node" | "cargo" | "git";
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly timeoutMs: number;
  readonly env?: (root: string) => Record<string, string>;
  /** Analisa a saída. `extra.vitest` vem do arquivo JSON do gate `test`. */
  readonly parse: (text: string, root: string, extra: { vitest?: VitestReport }) => GateFailure[];
  readonly okSummary?: (text: string, extra: { vitest?: VitestReport }) => string;
}

const MIN = 60_000;

/** Caminho temporário do JSON do vitest (fora do repo). */
function vitestOutputFile(): string {
  return path.join(os.tmpdir(), `engine-mcp-vitest-${randomUUID().slice(0, 8)}.json`);
}

const GATE_SPECS: Record<SingleGate, GateSpec> = {
  tsc: {
    cmd: "npx",
    args: ["tsc", "--noEmit", "-p", "."],
    timeoutMs: 10 * MIN,
    parse: (text, root) => parseTsc(text, root),
  },
  test: {
    cmd: "npx",
    // `--outputFile=<tmp>` é acrescentado em runSingle.
    args: ["vitest", "run", "--no-file-parallelism", "--reporter=json"],
    timeoutMs: 30 * MIN,
    parse: (text, root, extra) => (extra.vitest ? extra.vitest.failures : parseComposite(text, "vitest", root)),
    okSummary: (_t, extra) =>
      extra.vitest ? `${extra.vitest.counts.passed} teste(s) passaram em ${extra.vitest.counts.files} arquivo(s)` : "testes passaram",
  },
  arch: {
    cmd: "npm",
    args: ["run", "arch:check"],
    timeoutMs: 10 * MIN,
    parse: (text, root) => [...parseArch(text, root), ...parseGenericErrors(text, "npm run arch:check", root)],
  },
  isolation: {
    cmd: "npm",
    args: ["run", "project:isolation"],
    timeoutMs: 45 * MIN,
    parse: (text, root) => parseComposite(text, "npm run project:isolation", root),
  },
  agents: {
    cmd: "node",
    args: ["agents.mjs"],
    timeoutMs: 10 * MIN,
    parse: (text, root) => parseAgents(text, root),
  },
  stage90: {
    cmd: "npm",
    args: ["run", "stage90:validate"],
    timeoutMs: 60 * MIN,
    parse: (text, root) => parseComposite(text, "npm run stage90:validate", root),
  },
  "ai-manual": {
    cmd: "npm",
    args: ["run", "ai-manual:check"],
    timeoutMs: 5 * MIN,
    parse: (text, root) => {
      const out = parseGenericErrors(text, "docs/ai", root);
      const drift = /\[AI-MANUAL\] (?!OK)(.+)/.exec(text);
      if (drift) out.unshift({ file: "docs/ai", code: "AI_MANUAL_DRIFT", message: `${drift[1]!.trim()} — rode npm run ai-manual:generate` });
      return out;
    },
  },
  build: {
    cmd: "npm",
    args: ["run", "build"],
    timeoutMs: 20 * MIN,
    parse: (text, root) => parseComposite(text, "npm run build", root),
  },
  "cargo-check": {
    cmd: "cargo",
    args: ["check"],
    cwd: "src-tauri",
    timeoutMs: 60 * MIN,
    env: (root) => ({ CARGO_TARGET_DIR: path.join(root, "src-tauri", "target"), CARGO_TERM_COLOR: "never" }),
    parse: (text, root) => parseCargo(text, { root, crateDir: "src-tauri" }),
  },
  "cargo-test": {
    cmd: "cargo",
    args: ["test"],
    cwd: "src-tauri",
    timeoutMs: 60 * MIN,
    env: (root) => ({ CARGO_TARGET_DIR: path.join(root, "src-tauri", "target"), CARGO_TERM_COLOR: "never" }),
    parse: (text, root) => parseCargo(text, { root, crateDir: "src-tauri" }),
  },
  "diff-check": {
    cmd: "git",
    args: ["diff", "--check"],
    timeoutMs: 2 * MIN,
    parse: (text, root) => parseDiffCheck(text, root),
    okSummary: () => "sem problemas de espaço em branco no diff",
  },
};

export function isGateName(value: unknown): value is GateName {
  return typeof value === "string" && (GATES as readonly string[]).includes(value);
}

/** Linha de comando legível do gate. */
export function gateCommand(gate: GateName): string {
  if (gate === "all") return ALL_ORDER.map((g) => gateCommand(g)).join(" && ");
  const spec = GATE_SPECS[gate];
  const cmd = `${spec.cmd} ${spec.args.join(" ")}${gate === "test" ? " --outputFile=<tmp>" : ""}`;
  return spec.cwd ? `(cd ${spec.cwd} && ${cmd})` : cmd;
}

/** Timeout padrão do gate (o `all` soma todos). */
export function gateTimeoutMs(gate: GateName): number {
  if (gate === "all") return ALL_ORDER.reduce((s, g) => s + GATE_SPECS[g].timeoutMs, 0);
  return GATE_SPECS[gate].timeoutMs;
}

function cargoMissing(spawnError: string | undefined): boolean {
  return spawnError !== undefined && /ENOENT/.test(spawnError);
}

function summarizeFailures(gate: string, failures: readonly GateFailure[], exitCode: number | null, timedOut: boolean): string {
  if (timedOut) return `${gate}: tempo esgotado`;
  if (failures.length === 0) return `${gate}: falhou (código ${exitCode ?? "nulo"}); veja tail`;
  const first = failures[0]!;
  const where = first.file ? `${first.file}${first.line !== undefined ? `:${first.line}` : ""}` : "";
  return `${gate}: ${failures.length} falha(s) — ${where ? `${where} ` : ""}${first.code ? `[${first.code}] ` : ""}${first.message.split("\n")[0]}`;
}

/** Roda um gate simples. Lança `COMMAND_FAILED` se o comando nem iniciou (ex.: cargo ausente). */
export async function runSingleGate(env: GateEnv, gate: SingleGate, options: GateRunOptions = {}): Promise<GateStepResult> {
  const spec = GATE_SPECS[gate];
  if (spec.cwd && !existsSync(path.join(env.root, spec.cwd))) {
    throw new McpToolError("NOT_FOUND", `${gate}: pasta ${spec.cwd} não existe neste repositório`);
  }
  const outputFile = gate === "test" ? vitestOutputFile() : null;
  const args = outputFile ? [...spec.args, `--outputFile=${outputFile}`] : [...spec.args];
  const merged = new TailBuffer(OUTPUT_LIMIT);
  const onChunk = (c: Buffer): void => {
    merged.push(c);
    options.onOutput?.(c);
  };
  const proc = env.exec.spawnAllowed(spec.cmd, args, {
    ...(spec.cwd ? { cwd: spec.cwd } : {}),
    env: { ...(spec.env ? spec.env(env.root) : {}), ...(options.env ?? {}) },
    timeoutMs: options.timeoutMs ?? spec.timeoutMs,
    ...(options.signal ? { signal: options.signal } : {}),
    onStdout: onChunk,
    onStderr: onChunk,
  });
  const exit = await proc.exited;
  const text = merged.toString();
  const command = gateCommand(gate);

  let vitest: VitestReport | undefined;
  if (outputFile) {
    try {
      vitest = parseVitestJson(await readFile(outputFile, "utf8"), env.root);
    } catch {
      vitest = undefined;
    } finally {
      await rm(outputFile, { force: true }).catch(() => undefined);
    }
  }

  if (exit.aborted) {
    throw new McpToolError("COMMAND_FAILED", `${gate}: cancelado`, "A chamada foi cancelada pelo cliente.");
  }
  if (exit.spawnError !== undefined && exit.code === null) {
    if (spec.cmd === "cargo" && cargoMissing(exit.spawnError)) {
      throw new McpToolError(
        "COMMAND_FAILED",
        `${gate}: cargo não encontrado no PATH (${exit.spawnError})`,
        "Instale o Rust (https://rustup.rs) e garanta que `cargo` está no PATH do processo do MCP.",
      );
    }
    throw new McpToolError("COMMAND_FAILED", `${gate}: não foi possível iniciar ${spec.cmd} (${exit.spawnError})`);
  }

  const ok = exit.code === 0 && !exit.timedOut && (gate !== "test" || vitest === undefined || vitest.success);
  let failures = ok ? [] : dedupeFailures(spec.parse(text, env.root, vitest ? { vitest } : {}));
  if (!ok && exit.timedOut) failures.unshift({ file: command, code: "TIMEOUT", message: `tempo esgotado após ${exit.durationMs} ms` });
  const failureCount = failures.length;
  failures = failures.slice(0, MAX_FAILURES);
  const summary = ok
    ? `${gate}: ok${spec.okSummary ? ` — ${spec.okSummary(text, vitest ? { vitest } : {})}` : ""}`
    : summarizeFailures(gate, failures, exit.code, exit.timedOut);
  return {
    gate,
    ok,
    command,
    exitCode: exit.code,
    timedOut: exit.timedOut,
    durationMs: exit.durationMs,
    summary,
    failures,
    failureCount,
    tail: tailText(text, TAIL_CHARS),
  };
}

/** Roda um gate (ou `all`, em sequência). */
export async function runGate(env: GateEnv, gate: GateName, options: GateRunOptions = {}): Promise<GateRunResult> {
  if (!isGateName(gate)) throw new McpToolError("INVALID_INPUT", `gate desconhecido: ${String(gate)}`, `Use: ${GATES.join(", ")}.`);
  if (gate !== "all") {
    options.onStep?.({ gate, index: 0, total: 1, phase: "start" });
    const r = await runSingleGate(env, gate, options);
    options.onStep?.({ gate, index: 0, total: 1, phase: "end", result: r });
    return r;
  }
  const started = Date.now();
  const steps: GateStepResult[] = [];
  const total = ALL_ORDER.length;
  let stoppedAt = -1;
  for (let i = 0; i < total; i++) {
    const g = ALL_ORDER[i]!;
    if (options.signal?.aborted) throw new McpToolError("COMMAND_FAILED", "all: cancelado", "A chamada foi cancelada pelo cliente.");
    options.onStep?.({ gate: g, index: i, total, phase: "start" });
    let r: GateStepResult;
    try {
      r = await runSingleGate(env, g, options);
    } catch (error) {
      if (!(error instanceof McpToolError) || /cancelado/.test(error.message)) throw error;
      // Comando ausente (ex.: cargo) vira passo reprovado no `all`.
      r = {
        gate: g,
        ok: false,
        command: gateCommand(g),
        exitCode: null,
        timedOut: false,
        durationMs: 0,
        summary: `${g}: ${error.message}`,
        failures: [{ file: gateCommand(g), code: error.code, message: `${error.message}${error.hint ? ` — ${error.hint}` : ""}` }],
        failureCount: 1,
        tail: "",
      };
    }
    steps.push(r);
    options.onStep?.({ gate: g, index: i, total, phase: "end", result: r });
    if (!r.ok && !options.continueOnFailure) {
      stoppedAt = i;
      break;
    }
  }
  const failedSteps = steps.filter((s) => !s.ok);
  const ok = failedSteps.length === 0 && stoppedAt < 0;
  const allFailures = failedSteps.flatMap((s) => s.failures.map((f) => ({ ...f, message: `[${s.gate}] ${f.message}` })));
  const skipped = stoppedAt >= 0 ? ALL_ORDER.slice(stoppedAt + 1) : [];
  const summary = ok
    ? `all: ok — ${steps.length} gate(s) passaram`
    : `all: ${failedSteps.length} gate(s) reprovado(s) (${failedSteps.map((s) => s.gate).join(", ")})${skipped.length ? `; não rodaram: ${skipped.join(", ")}` : ""}`;
  const lastFailed = failedSteps[failedSteps.length - 1];
  return {
    gate: "all",
    ok,
    command: gateCommand("all"),
    exitCode: ok ? 0 : (lastFailed?.exitCode ?? 1),
    timedOut: steps.some((s) => s.timedOut),
    durationMs: Date.now() - started,
    summary,
    failures: allFailures.slice(0, MAX_FAILURES),
    failureCount: failedSteps.reduce((s, f) => s + f.failureCount, 0),
    tail: lastFailed?.tail ?? steps[steps.length - 1]?.tail ?? "",
    steps,
    skipped: [...skipped],
  };
}

/** Lê a linha `@@ENGINE_GATE_RESULT@@ {json}` (a última) de um log de job. */
export function extractGateResult(log: string): { result?: GateRunResult; error?: { code: string; message: string; hint?: string } } | null {
  const idx = log.lastIndexOf(RESULT_MARKER);
  if (idx < 0) return null;
  const rest = log.slice(idx + RESULT_MARKER.length);
  const end = rest.indexOf("\n");
  try {
    const parsed = JSON.parse(end >= 0 ? rest.slice(0, end) : rest) as Record<string, unknown>;
    if (parsed.error && typeof parsed.error === "object") return { error: parsed.error as { code: string; message: string; hint?: string } };
    return { result: parsed as unknown as GateRunResult };
  } catch {
    return null;
  }
}

/* ============================================================================
 * Testes isolados (test_run) e auditorias (audit_run)
 * ========================================================================== */

export interface TestRunOptions {
  readonly files?: readonly string[];
  readonly namePattern?: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly onOutput?: (chunk: Buffer) => void;
}

export interface TestRunResult {
  ok: boolean;
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  summary: string;
  counts: VitestReport["counts"];
  files: VitestReport["files"];
  failures: GateFailure[];
  tail: string;
}

/** `vitest run --reporter=json` com filtros; devolve resultados por arquivo/teste. */
export async function runTests(env: GateEnv, options: TestRunOptions = {}): Promise<TestRunResult> {
  const outputFile = vitestOutputFile();
  const filters = [...(options.files ?? [])];
  const args = ["vitest", "run", "--no-file-parallelism", "--reporter=json", `--outputFile=${outputFile}`];
  if (options.namePattern) args.push("-t", options.namePattern);
  if (filters.length > 0) args.push("--", ...filters);
  const merged = new TailBuffer(OUTPUT_LIMIT);
  const onChunk = (c: Buffer): void => {
    merged.push(c);
    options.onOutput?.(c);
  };
  const proc = env.exec.spawnAllowed("npx", args, {
    timeoutMs: options.timeoutMs ?? GATE_SPECS.test.timeoutMs,
    ...(options.signal ? { signal: options.signal } : {}),
    onStdout: onChunk,
    onStderr: onChunk,
  });
  const exit = await proc.exited;
  const text = merged.toString();
  let report: VitestReport | null = null;
  try {
    report = parseVitestJson(await readFile(outputFile, "utf8"), env.root);
  } catch {
    report = null;
  } finally {
    await rm(outputFile, { force: true }).catch(() => undefined);
  }
  if (exit.aborted) throw new McpToolError("COMMAND_FAILED", "test_run: cancelado", "A chamada foi cancelada pelo cliente.");
  if (exit.spawnError !== undefined && exit.code === null) throw new McpToolError("COMMAND_FAILED", `test_run: não foi possível iniciar npx (${exit.spawnError})`);
  const command = `npx ${args.join(" ").replace(outputFile, "<tmp>")}`;
  if (!report) {
    const noFiles = /No test files found/i.test(text);
    if (noFiles) {
      throw new McpToolError("NOT_FOUND", "nenhum arquivo de teste corresponde aos filtros", "Confira `files` (caminhos relativos à raiz, ex.: tests/mcp/core.test.ts).");
    }
    const failures = exit.timedOut
      ? [{ file: command, code: "TIMEOUT", message: `tempo esgotado após ${exit.durationMs} ms` }]
      : parseComposite(text, "vitest", env.root);
    return {
      ok: false,
      command,
      exitCode: exit.code,
      timedOut: exit.timedOut,
      durationMs: exit.durationMs,
      summary: exit.timedOut ? "test_run: tempo esgotado" : "test_run: vitest não gerou o relatório JSON; veja tail",
      counts: { files: 0, failedFiles: 0, tests: 0, passed: 0, failed: 0, skipped: 0, todo: 0 },
      files: [],
      failures: failures.length > 0 ? failures : [{ file: command, message: `vitest terminou com código ${exit.code ?? "nulo"}` }],
      tail: tailText(text, TAIL_CHARS),
    };
  }
  const ok = exit.code === 0 && !exit.timedOut && report.success;
  const c = report.counts;
  return {
    ok,
    command,
    exitCode: exit.code,
    timedOut: exit.timedOut,
    durationMs: exit.durationMs,
    summary: `${ok ? "ok" : "reprovado"}: ${c.passed} passaram, ${c.failed} falharam, ${c.skipped} pulados em ${c.files} arquivo(s)`,
    counts: c,
    files: report.files,
    failures: report.failures.slice(0, MAX_FAILURES),
    tail: tailText(text, TAIL_CHARS),
  };
}

export const AUDIT_STAGE_MIN = 71;
export const AUDIT_STAGE_MAX = 90;

/** Script da auditoria de um stage: `stageNN-audit-*.mjs` (ou `stageNN-validate-*.mjs` se não houver audit). */
export function findAuditScript(root: string, stage: number): string | null {
  const dir = path.join(root, "scripts", "architecture");
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  const pick = (kind: string): string | undefined =>
    entries.filter((f) => f.startsWith(`stage${stage}-${kind}-`) && f.endsWith(".mjs")).sort()[0];
  const file = pick("audit") ?? pick("validate");
  return file ? `scripts/architecture/${file}` : null;
}

export interface AuditRunResult {
  ok: boolean;
  stage: number;
  script: string;
  format: "json" | "text";
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  summary: string;
  violations: GateFailure[];
  tail: string;
}

export async function runAudit(env: GateEnv, stage: number, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<AuditRunResult> {
  const script = findAuditScript(env.root, stage);
  if (!script) {
    throw new McpToolError("NOT_FOUND", `não há script de auditoria para o stage ${stage}`, "Procure em scripts/architecture/stageNN-audit-*.mjs.");
  }
  const source = await readFile(path.join(env.root, script), "utf8").catch(() => "");
  const useJson = source.includes('"--json"');
  const stdout = new TailBuffer(OUTPUT_LIMIT * 4);
  const merged = new TailBuffer(OUTPUT_LIMIT);
  const proc = env.exec.spawnAllowed("node", useJson ? [script, "--json"] : [script], {
    timeoutMs: options.timeoutMs ?? (stage === 90 ? 60 * MIN : 10 * MIN),
    ...(options.signal ? { signal: options.signal } : {}),
    onStdout: (c) => {
      stdout.push(c);
      merged.push(c);
    },
    onStderr: (c) => merged.push(c),
  });
  const exit = await proc.exited;
  if (exit.aborted) throw new McpToolError("COMMAND_FAILED", `audit_run ${stage}: cancelado`, "A chamada foi cancelada pelo cliente.");
  if (exit.spawnError !== undefined && exit.code === null) throw new McpToolError("COMMAND_FAILED", `audit_run ${stage}: não foi possível iniciar node (${exit.spawnError})`);
  const text = merged.toString();
  let format: "json" | "text" = "text";
  let violations: GateFailure[] = [];
  let jsonOk: boolean | null = null;
  if (useJson) {
    const raw = stdout.toString();
    const start = raw.indexOf("{");
    try {
      const parsed = normalizeAuditJson(JSON.parse(raw.slice(start >= 0 ? start : 0)), env.root);
      format = "json";
      violations = parsed.failures;
      jsonOk = parsed.ok;
    } catch {
      format = "text";
    }
  }
  if (format === "text") {
    violations = dedupeFailures([...parseLayer1Audit(text, env.root), ...(exit.code !== 0 ? parseComposite(text, script, env.root) : [])]);
  }
  const ok = exit.code === 0 && !exit.timedOut && (jsonOk ?? true) && (format === "json" || violations.length === 0);
  if (!ok && violations.length === 0) {
    violations.push({ file: script, message: exit.timedOut ? "tempo esgotado" : `auditoria terminou com código ${exit.code ?? "nulo"}; veja tail` });
  }
  const count = ok ? 0 : violations.length;
  return {
    ok,
    stage,
    script,
    format,
    exitCode: exit.code,
    timedOut: exit.timedOut,
    durationMs: exit.durationMs,
    summary: ok ? `stage ${stage}: 0 violações` : `stage ${stage}: ${count} violação(ões) — ${violations[0]!.code ? `[${violations[0]!.code}] ` : ""}${violations[0]!.message.split("\n")[0]}`,
    violations: violations.slice(0, MAX_FAILURES),
    tail: tailText(text, TAIL_CHARS),
  };
}
