/**
 * Domínio `jobs` — acompanhamento de tarefas longas (SPEC §3.3).
 *
 * Os jobs são criados por outras tools (`gate_run { async: true }`,
 * `build_web`…) via `ctx.jobs.start(...)`; aqui só se lista, consulta,
 * lê o log e cancela.
 */

import { z } from "zod";
import { DEFAULT_LOG_READ_BYTES, MAX_LOG_READ_BYTES, type JobInfo } from "../core/jobs.ts";
import { defineTool, type ToolDef } from "../core/registry.ts";

const jobState = z.enum(["running", "succeeded", "failed", "cancelled"]);

export const jobInfoSchema = z.object({
  jobId: z.string(),
  label: z.string(),
  command: z.string(),
  args: z.array(z.string()),
  cwd: z.string(),
  state: jobState,
  exitCode: z.number().nullable(),
  signal: z.string().nullable(),
  timedOut: z.boolean(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  durationMs: z.number(),
  logBytes: z.number(),
  logStart: z.number(),
  error: z.string().optional(),
});

const jobIdInput = z.string().min(1).describe("id devolvido pela tool que iniciou o job (ex.: job-1a2b3c4d)");

function describe(job: JobInfo): string {
  const code = job.exitCode !== null ? ` (código ${job.exitCode})` : "";
  return `${job.jobId} [${job.state}]${code} ${job.label}`;
}

export const tools: ToolDef[] = [
  defineTool({
    name: "job_list",
    title: "Listar jobs",
    description: "Lista os jobs longos (rodando e terminados na última hora) com estado e código de saída.",
    output: { jobs: z.array(jobInfoSchema), running: z.number(), limit: z.number() },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (_args, ctx) => ({ jobs: ctx.jobs.list(), running: ctx.jobs.runningCount, limit: ctx.jobs.limit }),
    summarize: (out) => `${out.jobs.length} job(s), ${out.running} rodando (limite ${out.limit})`,
  }),

  defineTool({
    name: "job_status",
    title: "Estado de um job",
    description: "Estado de um job: running/succeeded/failed/cancelled, código de saída, duração e tamanho do log.",
    input: { jobId: jobIdInput },
    output: jobInfoSchema,
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: ({ jobId }, ctx) => ctx.jobs.status(jobId),
    summarize: (job) => describe(job as JobInfo),
  }),

  defineTool({
    name: "job_log",
    title: "Log de um job",
    description:
      "Lê o log (stdout+stderr) de um job a partir de um offset absoluto em bytes. Use `nextOffset` da resposta na próxima chamada para acompanhar. O log guarda os últimos 4 MiB; `truncatedBefore` indica que o início já saiu do buffer.",
    input: {
      jobId: jobIdInput,
      offset: z.number().int().min(0).optional().describe("offset absoluto (padrão 0 = mais antigo retido)"),
      maxBytes: z.number().int().min(1).max(MAX_LOG_READ_BYTES).optional().describe(`padrão ${DEFAULT_LOG_READ_BYTES}`),
    },
    output: {
      jobId: z.string(),
      state: jobState,
      done: z.boolean(),
      offset: z.number(),
      nextOffset: z.number(),
      logStart: z.number(),
      logBytes: z.number(),
      truncatedBefore: z.boolean(),
      text: z.string(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: ({ jobId, offset, maxBytes }, ctx) => ctx.jobs.readLog(jobId, offset ?? 0, maxBytes ?? DEFAULT_LOG_READ_BYTES),
    summarize: (out) => `${out.jobId} [${out.state}] bytes ${out.offset}–${out.nextOffset} de ${out.logBytes}${out.truncatedBefore ? " (início truncado)" : ""}`,
  }),

  defineTool({
    name: "job_cancel",
    title: "Cancelar job",
    description: "Cancela um job em execução (mata a árvore de processos) e devolve o estado final. Job já terminado: devolve o estado sem mudar nada.",
    input: { jobId: jobIdInput },
    output: jobInfoSchema,
    annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run: ({ jobId }, ctx) => ctx.jobs.cancel(jobId),
    summarize: (job) => describe(job as JobInfo),
  }),
];
