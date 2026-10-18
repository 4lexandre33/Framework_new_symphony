/**
 * Jobs longos (build, testes, tauri build) — SPEC §1.4.
 *
 * - Até `limit` jobs simultâneos (padrão 4); acima disso `JOB_LIMIT`.
 * - stdout+stderr num log em anel de 4 MiB com offsets absolutos em bytes:
 *   `log(id, offset)` devolve a partir de `offset` (ou do byte mais antigo
 *   retido) e `nextOffset` para a próxima leitura.
 * - Jobs terminados expiram após 1 h.
 */

import { randomUUID } from "node:crypto";
import { McpToolError } from "./errors.ts";
import type { Executor, RunningProcess, SpawnOptions } from "./exec.ts";
import type { Logger } from "./log.ts";
import { silentLogger } from "./log.ts";

export type JobState = "running" | "succeeded" | "failed" | "cancelled";

export interface JobInfo {
  readonly jobId: string;
  readonly label: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly state: JobState;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly timedOut: boolean;
  /** ISO 8601. */
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly durationMs: number;
  /** Total de bytes já escritos no log (offset absoluto do fim). */
  readonly logBytes: number;
  /** Offset absoluto do byte mais antigo ainda retido. */
  readonly logStart: number;
  readonly error?: string;
}

export interface JobLogChunk {
  readonly jobId: string;
  readonly state: JobState;
  readonly done: boolean;
  /** Offset absoluto do primeiro byte devolvido. */
  readonly offset: number;
  /** Offset para a próxima chamada. */
  readonly nextOffset: number;
  readonly logStart: number;
  readonly logBytes: number;
  /** `true` se o offset pedido já tinha saído do anel. */
  readonly truncatedBefore: boolean;
  readonly text: string;
}

export interface JobStartOptions extends Pick<SpawnOptions, "cwd" | "env" | "stdin"> {
  /** Padrão 30 min; `0` = sem timeout. */
  readonly timeoutMs?: number;
  /** Chamado uma vez quando o job termina (sucesso, falha ou cancelamento). */
  readonly onExit?: (info: JobInfo) => void;
}

export interface JobManagerOptions {
  readonly limit?: number;
  readonly logLimitBytes?: number;
  readonly ttlMs?: number;
  readonly log?: Logger;
}

export const DEFAULT_JOB_TIMEOUT_MS = 30 * 60_000;
export const DEFAULT_JOB_LOG_BYTES = 4 * 1024 * 1024;
export const DEFAULT_JOB_TTL_MS = 60 * 60_000;
export const DEFAULT_LOG_READ_BYTES = 64 * 1024;
export const MAX_LOG_READ_BYTES = 1024 * 1024;

/** Log em anel com offsets absolutos. */
export class RingLog {
  private chunks: Buffer[] = [];
  private size = 0;
  /** Bytes totais escritos. */
  total = 0;
  constructor(private readonly limit: number) {}

  get start(): number {
    return this.total - this.size;
  }

  write(chunk: Buffer): void {
    if (chunk.length === 0) return;
    if (chunk.length >= this.limit) {
      this.chunks = [chunk.subarray(chunk.length - this.limit)];
      this.size = this.limit;
      this.total += chunk.length;
      return;
    }
    this.chunks.push(chunk);
    this.size += chunk.length;
    this.total += chunk.length;
    while (this.size > this.limit) {
      const head = this.chunks[0]!;
      const excess = this.size - this.limit;
      if (head.length <= excess) {
        this.chunks.shift();
        this.size -= head.length;
      } else {
        this.chunks[0] = head.subarray(excess);
        this.size -= excess;
      }
    }
  }

  read(offset: number, maxBytes: number): { offset: number; data: Buffer; truncatedBefore: boolean } {
    const start = this.start;
    const truncatedBefore = offset < start;
    const from = Math.min(Math.max(offset, start), this.total);
    const len = Math.max(0, Math.min(maxBytes, this.total - from));
    if (len === 0) return { offset: from, data: Buffer.alloc(0), truncatedBefore };
    const all = Buffer.concat(this.chunks);
    const rel = from - start;
    return { offset: from, data: all.subarray(rel, rel + len), truncatedBefore };
  }
}

interface JobRecord {
  readonly jobId: string;
  readonly label: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly startedAt: number;
  readonly log: RingLog;
  readonly proc: RunningProcess;
  state: JobState;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  endedAt: number | null;
  cancelRequested: boolean;
  error?: string;
  readonly done: Promise<JobInfo>;
}

export class JobManager {
  readonly limit: number;
  private readonly logLimit: number;
  private readonly ttlMs: number;
  private readonly log: Logger;
  private readonly jobs = new Map<string, JobRecord>();
  private readonly sweeper: NodeJS.Timeout;
  private disposed = false;

  constructor(
    private readonly exec: Executor,
    options: JobManagerOptions = {},
  ) {
    this.limit = options.limit ?? 4;
    this.logLimit = options.logLimitBytes ?? DEFAULT_JOB_LOG_BYTES;
    this.ttlMs = options.ttlMs ?? DEFAULT_JOB_TTL_MS;
    this.log = options.log ?? silentLogger;
    this.sweeper = setInterval(() => this.prune(), 60_000);
    this.sweeper.unref();
  }

  get runningCount(): number {
    let n = 0;
    for (const j of this.jobs.values()) if (j.state === "running") n++;
    return n;
  }

  /** Inicia um job (comando da allowlist). Lança `JOB_LIMIT` se cheio. */
  start(label: string, cmd: string, args: readonly string[], options: JobStartOptions = {}): JobInfo {
    if (this.disposed) throw new McpToolError("INTERNAL", "JobManager já encerrado");
    this.prune();
    if (this.runningCount >= this.limit) {
      throw new McpToolError("JOB_LIMIT", `limite de ${this.limit} jobs simultâneos atingido`, "Espere um job terminar (job_status) ou cancele um (job_cancel).");
    }
    const ring = new RingLog(this.logLimit);
    const proc = this.exec.spawnAllowed(cmd, args, {
      ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
      ...(options.env !== undefined ? { env: options.env } : {}),
      ...(options.stdin !== undefined ? { stdin: options.stdin } : {}),
      timeoutMs: options.timeoutMs ?? DEFAULT_JOB_TIMEOUT_MS,
      onStdout: (c) => ring.write(c),
      onStderr: (c) => ring.write(c),
    });
    const jobId = `job-${randomUUID().slice(0, 8)}`;
    let record!: JobRecord;
    const done = proc.exited.then((exit) => {
      record.exitCode = exit.code;
      record.signal = exit.signal;
      record.timedOut = exit.timedOut;
      record.endedAt = Date.now();
      if (exit.spawnError !== undefined) record.error = exit.spawnError;
      if (record.cancelRequested) record.state = "cancelled";
      else record.state = exit.code === 0 && !exit.timedOut ? "succeeded" : "failed";
      const info = this.toInfo(record);
      this.log.debug(`job ${jobId} ${record.state}`, { exitCode: exit.code });
      try {
        options.onExit?.(info);
      } catch (error) {
        this.log.warn(`onExit do job ${jobId} lançou`, error);
      }
      return info;
    });
    record = {
      jobId,
      label,
      command: cmd,
      args: [...args],
      cwd: proc.cwd,
      startedAt: Date.now(),
      log: ring,
      proc,
      state: "running",
      exitCode: null,
      signal: null,
      timedOut: false,
      endedAt: null,
      cancelRequested: false,
      done,
    };
    this.jobs.set(jobId, record);
    this.log.info(`job ${jobId} iniciado: ${label}`);
    return this.toInfo(record);
  }

  list(): JobInfo[] {
    this.prune();
    return [...this.jobs.values()].map((j) => this.toInfo(j));
  }

  status(jobId: string): JobInfo {
    return this.toInfo(this.get(jobId));
  }

  readLog(jobId: string, offset = 0, maxBytes = DEFAULT_LOG_READ_BYTES): JobLogChunk {
    const job = this.get(jobId);
    const max = Math.min(Math.max(1, Math.floor(maxBytes)), MAX_LOG_READ_BYTES);
    const { offset: from, data, truncatedBefore } = job.log.read(Math.max(0, Math.floor(offset)), max);
    return {
      jobId,
      state: job.state,
      done: job.state !== "running",
      offset: from,
      nextOffset: from + data.length,
      logStart: job.log.start,
      logBytes: job.log.total,
      truncatedBefore,
      text: data.toString("utf8"),
    };
  }

  /** Cancela (mata a árvore) e espera terminar. Job já terminado: devolve o estado. */
  async cancel(jobId: string): Promise<JobInfo> {
    const job = this.get(jobId);
    if (job.state !== "running") return this.toInfo(job);
    job.cancelRequested = true;
    await job.proc.kill();
    return job.done;
  }

  /** Espera o job terminar (ou `timeoutMs`, devolvendo o estado atual). */
  async wait(jobId: string, timeoutMs = 0): Promise<JobInfo> {
    const job = this.get(jobId);
    if (timeoutMs <= 0) return job.done;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<JobInfo>((resolve) => {
      timer = setTimeout(() => resolve(this.toInfo(job)), timeoutMs);
    });
    try {
      return await Promise.race([job.done, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Cancela tudo que está rodando e para o coletor. */
  async disposeAll(): Promise<void> {
    this.disposed = true;
    clearInterval(this.sweeper);
    await Promise.all(
      [...this.jobs.values()].filter((j) => j.state === "running").map((j) => this.cancel(j.jobId).catch(() => undefined)),
    );
  }

  /** Remove jobs terminados há mais de `ttlMs`. */
  prune(now = Date.now()): void {
    for (const [id, job] of this.jobs) {
      if (job.state !== "running" && job.endedAt !== null && now - job.endedAt > this.ttlMs) this.jobs.delete(id);
    }
  }

  private get(jobId: string): JobRecord {
    const job = this.jobs.get(jobId);
    if (!job) throw new McpToolError("NOT_FOUND", `job não encontrado: ${jobId}`, "Use job_list para ver os jobs (terminados expiram em 1 h).");
    return job;
  }

  private toInfo(job: JobRecord): JobInfo {
    const end = job.endedAt ?? Date.now();
    return {
      jobId: job.jobId,
      label: job.label,
      command: job.command,
      args: job.args,
      cwd: job.cwd,
      state: job.state,
      exitCode: job.exitCode,
      signal: job.signal,
      timedOut: job.timedOut,
      startedAt: new Date(job.startedAt).toISOString(),
      endedAt: job.endedAt !== null ? new Date(job.endedAt).toISOString() : null,
      durationMs: end - job.startedAt,
      logBytes: job.log.total,
      logStart: job.log.start,
      ...(job.error !== undefined ? { error: job.error } : {}),
    };
  }
}
