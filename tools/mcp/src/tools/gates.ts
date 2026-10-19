/**
 * Domínio `gates` — T4: gates, testes e auditorias (SPEC §3.3).
 *
 * - `gate_run`: roda um gate do repositório (tsc, test, arch, …, all) de forma
 *   síncrona (progresso + cancelamento) ou como job (`async: true`).
 * - `gate_result`: resultado estruturado de um `gate_run` assíncrono.
 * - `test_run`: vitest com filtros, resultado por arquivo/teste.
 * - `audit_run`: auditoria Layer-1 de um stage (71..90), violações estruturadas.
 *
 * A execução fica em `../gates/definitions.ts` (compartilhada com o runner do job).
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import type { ToolContext } from "../core/context.ts";
import { McpToolError } from "../core/errors.ts";
import { stripAnsi } from "../core/parsers.ts";
import { defineTool, type ToolCall, type ToolDef } from "../core/registry.ts";
import {
  AUDIT_STAGE_MAX,
  AUDIT_STAGE_MIN,
  extractGateResult,
  GATES,
  gateCommand,
  gateTimeoutMs,
  runAudit,
  runGate,
  runTests,
  type GateEnv,
  type GateName,
} from "../gates/definitions.ts";

/* ============================================================================
 * Schemas
 * ========================================================================== */

const failureSchema = z.object({
  file: z.string().describe("arquivo relativo à raiz (ou o comando, quando não há arquivo)"),
  line: z.number().optional(),
  column: z.number().optional(),
  code: z.string().optional().describe("código/regra: TS2322, BND001, E0425, DOC_REF_MISSING, TEST_FAILED…"),
  message: z.string(),
});

const gateEnum = z.enum(GATES);
const singleGateEnum = z.enum(GATES.filter((g) => g !== "all") as [Exclude<GateName, "all">, ...Exclude<GateName, "all">[]]);

const stepSchema = z.object({
  gate: singleGateEnum,
  ok: z.boolean(),
  command: z.string(),
  exitCode: z.number().nullable(),
  timedOut: z.boolean(),
  durationMs: z.number(),
  summary: z.string(),
  failures: z.array(failureSchema),
  failureCount: z.number(),
  tail: z.string(),
});

const gateResultShape = {
  gate: gateEnum,
  ok: z.boolean(),
  command: z.string(),
  exitCode: z.number().nullable(),
  timedOut: z.boolean(),
  durationMs: z.number(),
  summary: z.string(),
  failures: z.array(failureSchema),
  failureCount: z.number(),
  tail: z.string().describe("fim da saída (stdout+stderr), até 4000 caracteres"),
  steps: z.array(stepSchema).optional().describe("só no gate all: resultado de cada gate"),
  skipped: z.array(singleGateEnum).optional().describe("só no gate all: gates que não rodaram"),
};
const gateResultSchema = z.object(gateResultShape);

const testFileSchema = z.object({
  file: z.string(),
  status: z.enum(["passed", "failed", "skipped"]),
  message: z.string().optional(),
  durationMs: z.number().optional(),
  tests: z.array(
    z.object({
      name: z.string(),
      fullName: z.string(),
      ancestors: z.array(z.string()),
      status: z.enum(["passed", "failed", "skipped", "pending", "todo", "disabled"]),
      durationMs: z.number().optional(),
      failureMessages: z.array(z.string()).optional(),
      line: z.number().optional(),
      column: z.number().optional(),
    }),
  ),
});

/* ============================================================================
 * Job assíncrono: runner em tsx
 * ========================================================================== */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNNER = path.resolve(HERE, "..", "gates", "runner.ts");

/** `--import` do tsx: loader absoluto achado subindo a partir do MCP (ou `tsx`). */
function tsxImport(): string {
  let dir = HERE;
  for (;;) {
    const loader = path.join(dir, "node_modules", "tsx", "dist", "loader.mjs");
    if (existsSync(loader)) return pathToFileURL(loader).href;
    const parent = path.dirname(dir);
    if (parent === dir) return "tsx";
    dir = parent;
  }
}

function gateEnv(ctx: ToolContext): GateEnv {
  return { root: ctx.root, exec: ctx.exec };
}

/** Progresso periódico durante uma execução síncrona. */
function progressReporter(call: ToolCall, label: string): { onOutput: (c: Buffer) => void; step: (msg: string) => void; stop: () => void } {
  let tick = 0;
  let lastLine = "";
  let current = label;
  const started = Date.now();
  const send = (msg: string): void => {
    tick += 1;
    call.progress(tick, undefined, msg).catch(() => undefined);
  };
  const timer = setInterval(() => {
    const secs = Math.round((Date.now() - started) / 1000);
    send(`${current} — ${secs}s${lastLine ? ` — ${lastLine.slice(0, 160)}` : ""}`);
  }, 3000);
  timer.unref();
  return {
    onOutput: (c) => {
      const text = stripAnsi(c.toString("utf8"));
      const ls = text.split("\n").map((l) => l.trim()).filter((l) => l !== "");
      if (ls.length > 0) lastLine = ls[ls.length - 1]!;
    },
    step: (msg) => {
      current = msg;
      send(msg);
    },
    stop: () => clearInterval(timer),
  };
}

/* ============================================================================
 * Tools
 * ========================================================================== */

export const tools: ToolDef[] = [
  defineTool({
    name: "gate_run",
    title: "Rodar gate do repositório",
    description: [
      "Roda um gate de qualidade do repositório e devolve falhas estruturadas ({ file, line, column, code, message }).",
      "Gates: tsc (npx tsc --noEmit -p .), test (vitest, todos os testes), arch (npm run arch:check), isolation (npm run project:isolation),",
      "agents (node agents.mjs: freeze-lock + invariantes + arch), stage90 (npm run stage90:validate), ai-manual (npm run ai-manual:check),",
      "build (npm run build), cargo-check / cargo-test (em src-tauri, CARGO_TARGET_DIR=src-tauri/target), diff-check (git diff --check),",
      "all (todos em sequência; para no primeiro reprovado, salvo continueOnFailure).",
      "Gates longos (test, isolation, build, stage90, cargo-*, all) devem rodar com async: true — devolve jobId; acompanhe com job_status/job_log",
      "e pegue o resultado estruturado com gate_result. Gate reprovado NÃO é erro da tool: vem ok=false com failures.",
    ].join(" "),
    input: {
      gate: gateEnum.describe("qual gate rodar"),
      async: z.boolean().optional().describe("true = roda como job e devolve jobId imediatamente (padrão false)"),
      continueOnFailure: z.boolean().optional().describe("só para gate all: continua após um gate reprovado (padrão false)"),
    },
    output: {
      async: z.boolean(),
      jobId: z.string().optional().describe("quando async: id do job (job_status/job_log/job_cancel/gate_result)"),
      gate: gateResultShape.gate,
      command: gateResultShape.command,
      summary: gateResultShape.summary,
      ok: gateResultShape.ok.optional().describe("ausente quando async (veja gate_result)"),
      exitCode: gateResultShape.exitCode.optional(),
      timedOut: gateResultShape.timedOut.optional(),
      durationMs: gateResultShape.durationMs.optional(),
      failures: gateResultShape.failures.optional(),
      failureCount: gateResultShape.failureCount.optional(),
      tail: gateResultShape.tail.optional(),
      steps: gateResultShape.steps,
      skipped: gateResultShape.skipped,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    summarize: (o) =>
      o.async ? `job ${o.jobId} iniciado: ${o.summary}` : `${o.summary}${o.durationMs !== undefined ? ` (${o.durationMs} ms)` : ""}`,
    run: async ({ gate, async: runAsync, continueOnFailure }, ctx, call) => {
      if (continueOnFailure !== undefined && gate !== "all") {
        throw new McpToolError("INVALID_INPUT", "continueOnFailure só vale para o gate all");
      }
      if (runAsync) {
        const runnerArgs = ["--import", tsxImport(), RUNNER, "--gate", gate, ...(continueOnFailure ? ["--continue-on-failure"] : [])];
        const job = ctx.jobs.start(`gate ${gate}`, "node", runnerArgs, { timeoutMs: Math.round(gateTimeoutMs(gate) * 1.1) });
        return {
          async: true,
          jobId: job.jobId,
          gate,
          command: gateCommand(gate),
          summary: `gate ${gate} rodando como job; use gate_result { jobId: "${job.jobId}" } quando job_status indicar fim`,
        };
      }
      const rep = progressReporter(call, `gate ${gate}`);
      try {
        const result = await runGate(gateEnv(ctx), gate, {
          signal: call.signal,
          ...(continueOnFailure !== undefined ? { continueOnFailure } : {}),
          onOutput: rep.onOutput,
          onStep: (e) => {
            if (e.phase === "start") rep.step(`gate ${e.index + 1}/${e.total}: ${e.gate}`);
            else if (e.result) rep.step(e.result.summary);
          },
        });
        return { async: false, ...result };
      } finally {
        rep.stop();
      }
    },
  }),

  defineTool({
    name: "gate_result",
    title: "Resultado de gate assíncrono",
    description:
      "Resultado estruturado de um gate_run { async: true }: lê o fim do log do job. Enquanto o job roda, devolve done=false (sem result). Se o job foi cancelado ou morreu sem resultado, devolve done=true com o fim do log em tail.",
    input: { jobId: z.string().min(1).describe("jobId devolvido por gate_run { async: true }") },
    output: {
      jobId: z.string(),
      state: z.enum(["running", "succeeded", "failed", "cancelled"]),
      done: z.boolean(),
      result: gateResultSchema.optional(),
      tail: z.string().optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    summarize: (out) => (out.result ? `${out.jobId} [${out.state}] ${out.result.summary}` : `${out.jobId} [${out.state}]${out.done ? " sem resultado" : " ainda rodando"}`),
    run: ({ jobId }, ctx) => {
      const info = ctx.jobs.status(jobId);
      if (!info.label.startsWith("gate ")) {
        throw new McpToolError("INVALID_INPUT", `o job ${jobId} não é de gate_run (${info.label})`, "Use job_log para jobs de outras tools.");
      }
      if (info.state === "running") return { jobId, state: info.state, done: false };
      // Cancelado: o runner pode ter gravado "cancelado" ao receber SIGTERM;
      // não é falha do gate, é o pedido do usuário.
      if (info.state === "cancelled") {
        const last = ctx.jobs.readLog(jobId, Math.max(info.logStart, info.logBytes - 4000), 4000);
        return { jobId, state: info.state, done: true, tail: stripAnsi(last.text) };
      }
      const window = 1024 * 1024;
      const chunk = ctx.jobs.readLog(jobId, Math.max(info.logStart, info.logBytes - window), window);
      const parsed = extractGateResult(chunk.text);
      if (parsed?.error) {
        throw new McpToolError(parsed.error.code, parsed.error.message, parsed.error.hint);
      }
      const tail = stripAnsi(chunk.text).slice(-4000);
      if (!parsed?.result) return { jobId, state: info.state, done: true, tail };
      return { jobId, state: info.state, done: true, result: gateResultSchema.parse(parsed.result) };
    },
  }),

  defineTool({
    name: "test_run",
    title: "Rodar testes (vitest)",
    description:
      "Roda vitest (reporter JSON, sem paralelismo de arquivos) e devolve resultado por arquivo e por teste, com mensagens de falha e linha. `files`: caminhos relativos à raiz (ex.: tests/mcp/gates.test.ts) ou filtros de nome de arquivo; `namePattern`: regex do nome do teste (-t). Sem filtros roda a suíte toda (lento: prefira gate_run { gate: \"test\", async: true }).",
    input: {
      files: z
        .array(z.string().min(1).max(512))
        .max(100)
        .optional()
        .describe("arquivos/pastas de teste relativos à raiz, ou filtros de nome (ex.: \"gates.test\")"),
      namePattern: z.string().min(1).max(500).optional().describe("regex do nome do teste (vitest -t)"),
    },
    output: {
      ok: z.boolean(),
      command: z.string(),
      exitCode: z.number().nullable(),
      timedOut: z.boolean(),
      durationMs: z.number(),
      summary: z.string(),
      counts: z.object({
        files: z.number(),
        failedFiles: z.number(),
        tests: z.number(),
        passed: z.number(),
        failed: z.number(),
        skipped: z.number(),
        todo: z.number(),
      }),
      files: z.array(testFileSchema),
      failures: z.array(failureSchema),
      tail: z.string(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    summarize: (out) => `test_run ${out.summary} (${out.durationMs} ms)`,
    run: async ({ files, namePattern }, ctx, call) => {
      const filters: string[] = [];
      for (const f of files ?? []) {
        if (f.startsWith("-")) throw new McpToolError("INVALID_INPUT", `filtro inválido: ${f}`, "Use caminhos relativos, sem opções.");
        if (/[\\/]/.test(f) || /\.[cm]?[jt]sx?$/.test(f)) {
          const abs = ctx.paths.resolve(f);
          if (!existsSync(abs)) throw new McpToolError("NOT_FOUND", `arquivo de teste não existe: ${f}`);
          filters.push(ctx.paths.relative(abs));
        } else filters.push(f);
      }
      if (namePattern !== undefined) {
        try {
          new RegExp(namePattern);
        } catch {
          throw new McpToolError("INVALID_INPUT", `namePattern não é uma regex válida: ${namePattern}`);
        }
      }
      const rep = progressReporter(call, "vitest");
      try {
        return await runTests(gateEnv(ctx), {
          files: filters,
          ...(namePattern !== undefined ? { namePattern } : {}),
          signal: call.signal,
          onOutput: rep.onOutput,
        });
      } finally {
        rep.stop();
      }
    },
  }),

  defineTool({
    name: "audit_run",
    title: "Rodar auditoria Layer-1",
    description: `Roda a auditoria Layer-1 de um stage (${AUDIT_STAGE_MIN}..${AUDIT_STAGE_MAX}) — scripts/architecture/stageNN-audit-*.mjs (stage 90: stage90-validate-layer1-gate.mjs, lento) — e devolve as violações estruturadas ({ file, line?, code, message }). Usa --json quando o script suporta. Somente leitura: não destrava nem recertifica baselines.`,
    input: {
      stage: z.number().int().min(AUDIT_STAGE_MIN).max(AUDIT_STAGE_MAX).describe(`stage da auditoria (${AUDIT_STAGE_MIN}..${AUDIT_STAGE_MAX})`),
    },
    output: {
      ok: z.boolean(),
      stage: z.number(),
      script: z.string(),
      format: z.enum(["json", "text"]),
      exitCode: z.number().nullable(),
      timedOut: z.boolean(),
      durationMs: z.number(),
      summary: z.string(),
      violations: z.array(failureSchema),
      tail: z.string(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    summarize: (out) => `${out.summary} (${out.script}, ${out.durationMs} ms)`,
    run: async ({ stage }, ctx, call) => {
      const rep = progressReporter(call, `auditoria stage ${stage}`);
      try {
        return await runAudit(gateEnv(ctx), stage, { signal: call.signal });
      } finally {
        rep.stop();
      }
    },
  }),
];
