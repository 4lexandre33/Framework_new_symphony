/**
 * Contexto entregue a toda tool/resource/prompt e aos hooks `init`/`dispose`
 * dos domínios. Um contexto por instância de servidor (testes criam vários).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import type { EngineMcpConfig } from "./config.ts";
import { Executor } from "./exec.ts";
import { JobManager } from "./jobs.ts";
import type { Logger } from "./log.ts";
import { createRepoPaths, type RepoPaths } from "./paths.ts";

/** Versão do servidor MCP (não da engine). */
export const SERVER_NAME = "engine-mcp";
export const SERVER_VERSION = "0.1.0";

export interface ToolContext {
  /** Raiz absoluta do repositório (realpath). */
  readonly root: string;
  readonly config: EngineMcpConfig;
  readonly jobs: JobManager;
  readonly exec: Executor;
  readonly paths: RepoPaths;
  /** Log em stderr (stdout é o protocolo). */
  readonly log: Logger;
  /** Versão do servidor MCP. */
  readonly version: string;
  /** Versão do `package.json` da raiz (engine), ou `null`. */
  readonly engineVersion: string | null;
  /**
   * Registra limpeza a rodar no encerramento do servidor (ordem inversa),
   * depois dos `dispose` dos domínios e antes de matar jobs/processos.
   */
  onDispose(fn: () => void | Promise<void>): void;
}

export interface ContextHandle {
  readonly ctx: ToolContext;
  /** Roda os `onDispose`, cancela jobs e mata processos. Idempotente. */
  dispose(): Promise<void>;
}

function readEngineVersion(root: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

export function createToolContext(config: EngineMcpConfig, log: Logger): ContextHandle {
  const paths = createRepoPaths(config.root, { readonly: config.readonly });
  const exec = new Executor(paths, log.child("exec"));
  const jobs = new JobManager(exec, { limit: config.jobLimit, log: log.child("jobs") });
  const disposers: Array<() => void | Promise<void>> = [];
  let disposing: Promise<void> | null = null;

  const ctx: ToolContext = {
    root: paths.root,
    config: { ...config, root: paths.root },
    jobs,
    exec,
    paths,
    log,
    version: SERVER_VERSION,
    engineVersion: readEngineVersion(paths.root),
    onDispose: (fn) => {
      disposers.push(fn);
    },
  };

  const dispose = (): Promise<void> => {
    disposing ??= (async () => {
      for (const fn of disposers.reverse()) {
        try {
          await fn();
        } catch (error) {
          log.warn("falha num onDispose", error);
        }
      }
      await jobs.disposeAll();
      await exec.disposeAll();
    })();
    return disposing;
  };

  return { ctx, dispose };
}
