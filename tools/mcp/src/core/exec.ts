/**
 * Execução de comandos externos com allowlist (SPEC §1.2).
 *
 * - Só `node`, `npm`, `npx`, `cargo` e `git` (git apenas leitura:
 *   status, log, diff, rev-parse, branch, show).
 * - Nunca shell (`shell: false`); no Windows `npm`/`npx` rodam como
 *   `node <npm-cli.js>` (sem `.cmd`).
 * - Timeout, AbortSignal, saída limitada (mantém o fim), mescla de env.
 * - Cancelamento mata a árvore: no POSIX o filho é líder de um grupo de
 *   processos (`detached`) e recebe o sinal no grupo; no Windows `taskkill /T`.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { McpToolError } from "./errors.ts";
import type { Logger } from "./log.ts";
import { silentLogger } from "./log.ts";
import type { RepoPaths } from "./paths.ts";

export const ALLOWED_COMMANDS = ["node", "npm", "npx", "cargo", "git"] as const;
export type AllowedCommand = (typeof ALLOWED_COMMANDS)[number];

export const GIT_READ_SUBCOMMANDS = ["status", "log", "diff", "rev-parse", "branch", "show"] as const;

/** Opções de git que escrevem arquivos, executam programas ou trocam o repo. */
const GIT_FORBIDDEN_OPTION = /^(--output|--ext-diff|--exec-path|--upload-pack|--git-dir|--work-tree|--namespace|--config-env|-c$|-C$|--open-files-in-pager|-O)/;
/** Opções de `git branch` que alteram refs. */
const GIT_BRANCH_MUTATING = /^(-d|-D|-m|-M|-c|-C|-f|-u|-t|--delete|--move|--copy|--force|--set-upstream|--set-upstream-to|--unset-upstream|--edit-description|--track|--no-track|--create-reflog|--recurse-submodules)/;
/** Opções de `git branch` que tornam os argumentos posicionais filtros (leitura). */
const GIT_BRANCH_LISTING = /^(-l|--list|--contains|--no-contains|--merged|--no-merged|--points-at)/;

export const DEFAULT_EXEC_TIMEOUT_MS = 5 * 60_000;
export const DEFAULT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const KILL_GRACE_MS = 1500;
const CLOSE_GRACE_MS = 2000;

function notAllowed(message: string, hint?: string): McpToolError {
  return new McpToolError("COMMAND_NOT_ALLOWED", message, hint ?? `Comandos permitidos: ${ALLOWED_COMMANDS.join(", ")} (git só leitura: ${GIT_READ_SUBCOMMANDS.join(", ")}).`);
}

/** Lança `COMMAND_NOT_ALLOWED` se o comando/argumentos não passam na allowlist. */
export function assertCommandAllowed(cmd: string, args: readonly string[]): asserts cmd is AllowedCommand {
  if (!(ALLOWED_COMMANDS as readonly string[]).includes(cmd)) {
    throw notAllowed(`comando não permitido: ${cmd}`);
  }
  for (const arg of args) {
    if (typeof arg !== "string") throw notAllowed("argumento não textual");
    if (arg.includes("\0")) throw notAllowed("argumento com byte nulo");
  }
  if (cmd !== "git") return;
  const sub = args[0];
  if (sub === undefined || !(GIT_READ_SUBCOMMANDS as readonly string[]).includes(sub)) {
    throw notAllowed(`git ${sub ?? ""}: só subcomandos de leitura são permitidos`.trim(), `Use: ${GIT_READ_SUBCOMMANDS.join(", ")} (como primeiro argumento).`);
  }
  for (const arg of args.slice(1)) {
    if (arg === "--") break;
    if (GIT_FORBIDDEN_OPTION.test(arg)) throw notAllowed(`git ${sub}: opção não permitida: ${arg}`);
  }
  if (sub === "branch") {
    const opts = args.slice(1).filter((a) => a.startsWith("-"));
    const positional = args.slice(1).filter((a) => !a.startsWith("-"));
    const mutating = opts.find((o) => GIT_BRANCH_MUTATING.test(o));
    if (mutating) throw notAllowed(`git branch: opção que altera refs não permitida: ${mutating}`);
    if (positional.length > 0 && !opts.some((o) => GIT_BRANCH_LISTING.test(o))) {
      throw notAllowed("git branch com nome cria um branch; só listagem é permitida", "Use git branch --list <padrão>.");
    }
  }
}

interface ResolvedCommand {
  readonly file: string;
  readonly args: string[];
}

function findNpmCli(which: "npm" | "npx"): string | null {
  const cliName = which === "npm" ? "npm-cli.js" : "npx-cli.js";
  const candidates: string[] = [];
  const execpath = process.env.npm_execpath;
  if (execpath && /npm-cli\.js$/i.test(execpath)) candidates.push(path.join(path.dirname(execpath), cliName));
  const nodeDir = path.dirname(process.execPath);
  candidates.push(path.join(nodeDir, "node_modules", "npm", "bin", cliName));
  candidates.push(path.join(nodeDir, "..", "lib", "node_modules", "npm", "bin", cliName));
  return candidates.find((c) => existsSync(c)) ?? null;
}

/** Resolve o executável real (sem shell). Exportado para testes. */
export function resolveCommand(cmd: AllowedCommand, args: readonly string[], platform: NodeJS.Platform = process.platform): ResolvedCommand {
  if (cmd === "node") return { file: process.execPath, args: [...args] };
  if ((cmd === "npm" || cmd === "npx") && platform === "win32") {
    const cli = findNpmCli(cmd);
    if (!cli) {
      throw new McpToolError("COMMAND_FAILED", `não encontrei ${cmd}-cli.js ao lado do Node`, "Instale o npm junto com o Node ou rode o MCP com o Node do sistema.");
    }
    return { file: process.execPath, args: [cli, ...args] };
  }
  return { file: cmd, args: [...args] };
}

export interface SpawnOptions {
  /** Pasta de trabalho (relativa à raiz ou absoluta dentro dela). Padrão: raiz. */
  readonly cwd?: string;
  /** Mesclado sobre `process.env`; `undefined` remove a variável. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Padrão: 5 min (`runAllowed`); `0` = sem timeout. */
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  /** Texto enviado ao stdin (senão stdin é fechado). */
  readonly stdin?: string;
  readonly onStdout?: (chunk: Buffer) => void;
  readonly onStderr?: (chunk: Buffer) => void;
}

export interface ProcessExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly aborted: boolean;
  /** Erro de spawn (ex.: ENOENT) se o processo nem iniciou. */
  readonly spawnError?: string;
}

export interface RunningProcess {
  readonly pid: number | undefined;
  readonly command: AllowedCommand;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly exited: Promise<ProcessExit>;
  /** Mata a árvore de processos e espera o fim. */
  kill(): Promise<void>;
}

export interface ExecOptions extends SpawnOptions {
  /** Limite por stream (mantém o fim). Padrão 2 MiB. */
  readonly maxOutputBytes?: number;
}

export interface ExecResult extends ProcessExit {
  readonly stdout: string;
  readonly stderr: string;
  /** Bytes descartados do início de cada stream por causa do limite. */
  readonly stdoutDroppedBytes: number;
  readonly stderrDroppedBytes: number;
}

/** Buffer que mantém só os últimos `limit` bytes. */
export class TailBuffer {
  private chunks: Buffer[] = [];
  private size = 0;
  dropped = 0;
  constructor(private readonly limit: number) {}
  push(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.size += chunk.length;
    while (this.size > this.limit && this.chunks.length > 0) {
      const head = this.chunks[0]!;
      const excess = this.size - this.limit;
      if (head.length <= excess) {
        this.chunks.shift();
        this.size -= head.length;
        this.dropped += head.length;
      } else {
        this.chunks[0] = head.subarray(excess);
        this.size -= excess;
        this.dropped += excess;
      }
    }
  }
  toString(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

const isWindows = process.platform === "win32";

async function waitExit(child: ChildProcess, ms: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, ms);
    const onExit = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}

/** Mata o processo e seus descendentes. */
export async function killTree(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (pid === undefined) return;
  const alive = child.exitCode === null && child.signalCode === null;
  if (!alive) return;
  if (isWindows) {
    await new Promise<void>((resolve) => {
      const k = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true, shell: false });
      k.once("exit", () => resolve());
      k.once("error", () => {
        child.kill();
        resolve();
      });
    });
    await waitExit(child, KILL_GRACE_MS);
    return;
  }
  const signalGroup = (sig: NodeJS.Signals): void => {
    try {
      process.kill(-pid, sig);
    } catch {
      try {
        child.kill(sig);
      } catch {
        /* já morreu */
      }
    }
  };
  signalGroup("SIGTERM");
  if (!(await waitExit(child, KILL_GRACE_MS))) {
    signalGroup("SIGKILL");
    await waitExit(child, KILL_GRACE_MS);
  } else {
    // O líder saiu; garante que netos do grupo também morram.
    signalGroup("SIGKILL");
  }
}

/**
 * Executor ligado a uma raiz de repositório. Acompanha os processos vivos
 * para `disposeAll()` no encerramento do servidor.
 */
export class Executor {
  private readonly live = new Set<RunningProcess>();

  constructor(
    private readonly paths: RepoPaths,
    private readonly log: Logger = silentLogger,
  ) {}

  /** Processos ainda em execução. */
  get running(): number {
    return this.live.size;
  }

  /** Inicia um processo permitido (baixo nível; usado pelo JobManager). */
  spawnAllowed(cmd: string, args: readonly string[], options: SpawnOptions = {}): RunningProcess {
    assertCommandAllowed(cmd, args);
    const cwd = options.cwd !== undefined ? this.paths.resolve(options.cwd) : this.paths.root;
    const resolved = resolveCommand(cmd, args);
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    env.NO_COLOR = "1";
    env.FORCE_COLOR = "0";
    if (cmd === "git") {
      env.GIT_PAGER = "cat";
      env.PAGER = "cat";
      env.GIT_TERMINAL_PROMPT = "0";
      env.GIT_OPTIONAL_LOCKS = "0";
    }
    for (const [k, v] of Object.entries(options.env ?? {})) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }

    const started = Date.now();
    let timedOut = false;
    let aborted = false;
    const child = spawn(resolved.file, resolved.args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      detached: !isWindows,
      stdio: [options.stdin !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
    });
    this.log.debug(`spawn ${cmd} ${args.join(" ")}`, { cwd, pid: child.pid });

    if (options.stdin !== undefined && child.stdin) {
      child.stdin.on("error", () => undefined);
      child.stdin.end(options.stdin);
    }
    child.stdout?.on("data", (c: Buffer) => options.onStdout?.(c));
    child.stderr?.on("data", (c: Buffer) => options.onStderr?.(c));

    let killing: Promise<void> | null = null;
    const kill = (): Promise<void> => {
      killing ??= killTree(child);
      return killing;
    };

    const timeoutMs = options.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            void kill();
          }, timeoutMs)
        : null;
    const onAbort = (): void => {
      aborted = true;
      void kill();
    };
    if (options.signal) {
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener("abort", onAbort, { once: true });
    }

    const exited = new Promise<ProcessExit>((resolve) => {
      let spawnError: string | undefined;
      let exitInfo: { code: number | null; signal: NodeJS.Signals | null } | null = null;
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
        this.live.delete(handle);
        resolve({
          code: exitInfo?.code ?? null,
          signal: exitInfo?.signal ?? null,
          durationMs: Date.now() - started,
          timedOut,
          aborted,
          ...(spawnError !== undefined ? { spawnError } : {}),
        });
      };
      child.once("error", (error) => {
        spawnError = error.message;
        if (child.pid === undefined) finish();
      });
      child.once("exit", (code, signal) => {
        exitInfo = { code, signal };
        // Espera os streams fecharem; se um neto segurar o pipe, desiste.
        setTimeout(() => {
          child.stdout?.destroy();
          child.stderr?.destroy();
          finish();
        }, CLOSE_GRACE_MS).unref();
      });
      child.once("close", (code, signal) => {
        exitInfo ??= { code, signal };
        finish();
      });
    });

    const handle: RunningProcess = { pid: child.pid, command: cmd, args: [...args], cwd, exited, kill };
    this.live.add(handle);
    return handle;
  }

  /** Executa até o fim e devolve a saída (limitada, mantendo o fim). */
  async runAllowed(cmd: string, args: readonly string[], options: ExecOptions = {}): Promise<ExecResult> {
    const limit = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    const out = new TailBuffer(limit);
    const err = new TailBuffer(limit);
    const proc = this.spawnAllowed(cmd, args, {
      ...options,
      onStdout: (c) => {
        out.push(c);
        options.onStdout?.(c);
      },
      onStderr: (c) => {
        err.push(c);
        options.onStderr?.(c);
      },
    });
    const exit = await proc.exited;
    return {
      ...exit,
      stdout: out.toString(),
      stderr: err.toString(),
      stdoutDroppedBytes: out.dropped,
      stderrDroppedBytes: err.dropped,
    };
  }

  /** Mata todos os processos vivos. */
  async disposeAll(): Promise<void> {
    await Promise.all([...this.live].map((p) => p.kill()));
  }
}

/**
 * Converte um `ExecResult` em erro padronizado se não terminou com código 0
 * (`TIMEOUT` ou `COMMAND_FAILED`, com o fim da saída em `details`).
 */
export function ensureSuccess(result: ExecResult, label: string): ExecResult {
  if (result.timedOut) {
    throw new McpToolError("TIMEOUT", `${label}: tempo esgotado após ${result.durationMs} ms`, "Rode como job (async) ou aumente o timeout.");
  }
  if (result.code !== 0) {
    const tail = (result.stderr || result.stdout).slice(-4000);
    throw new McpToolError(
      "COMMAND_FAILED",
      `${label}: terminou com código ${result.code ?? "nulo"}${result.signal ? ` (sinal ${result.signal})` : ""}${result.spawnError ? ` — ${result.spawnError}` : ""}`,
      undefined,
      { code: result.code, tail },
    );
  }
  return result;
}
