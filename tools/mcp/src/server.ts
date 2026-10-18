/**
 * Servidor MCP da engine (SPEC docs/mcp/SPEC.md).
 *
 * `npm run mcp` (= `tsx tools/mcp/src/server.ts`) sobe o servidor em stdio.
 * Testes usam `createEngineMcpServer()` com `InMemoryTransport`.
 * stdout é exclusivo do protocolo: todo log vai para stderr.
 */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, type EngineMcpConfig } from "./core/config.ts";
import { createToolContext, SERVER_NAME, SERVER_VERSION, type ToolContext } from "./core/context.ts";
import { createLogger, type Logger } from "./core/log.ts";
import {
  registerDomain,
  registerPrompts,
  registerResources,
  useStructuredInputErrors,
  type PromptDef,
  type ResourceDef,
} from "./core/registry.ts";
import { prompts as defaultPrompts } from "./prompts.ts";
import { resources as defaultResources } from "./resources.ts";
import { domains as defaultDomains, type NamedDomain } from "./tools/index.ts";

export interface EngineMcpServerOptions {
  /** Raiz do repositório (senão ENGINE_MCP_ROOT / detecção). */
  readonly root?: string;
  /** Ambiente lido pela config. Padrão: `process.env`. */
  readonly env?: NodeJS.ProcessEnv;
  /** Sobrescreve campos da config (ex.: `{ readonly: true, jobLimit: 2 }`). */
  readonly config?: Partial<EngineMcpConfig>;
  readonly log?: Logger;
  /** Padrão: todos os domínios de ./tools/index.ts. */
  readonly domains?: readonly NamedDomain[];
  readonly resources?: readonly ResourceDef[];
  readonly prompts?: readonly PromptDef[];
}

export interface EngineMcpServer {
  readonly server: McpServer;
  readonly ctx: ToolContext;
  /** Fecha o transporte, roda `dispose` dos domínios, cancela jobs. Idempotente. */
  close(): Promise<void>;
}

export const SERVER_INSTRUCTIONS = [
  "MCP da engine Projeto_Engine: manual (docs/ai), jogos em src/projects/<id>, gates, jobs, runtime (DevBridge), cenas/assets e build/Steam.",
  "Comece por engine_info / docs_read RULES. Escrita só em src/projects/<id>/, docs/games/<id>/, src-tauri/gen/ e dist/ — nunca na engine.",
  "Tarefas longas devolvem jobId: acompanhe com job_status / job_log (offset) / job_cancel.",
  "Erros vêm com isError e { code, message, hint } (também em _meta['engine-mcp/error']).",
].join("\n");

export async function createEngineMcpServer(options: EngineMcpServerOptions = {}): Promise<EngineMcpServer> {
  const env = options.env ?? process.env;
  const config = loadConfig(env, { ...options.config, ...(options.root !== undefined ? { root: options.root } : {}) });
  const log = options.log ?? createLogger(config.logLevel);
  const { ctx, dispose: disposeCtx } = createToolContext(config, log);
  const domainList = options.domains ?? defaultDomains;

  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: SERVER_INSTRUCTIONS });
  useStructuredInputErrors(server);

  const initialized: NamedDomain[] = [];
  let closing: Promise<void> | null = null;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      try {
        await server.close();
      } catch (error) {
        log.warn("erro ao fechar o transporte", error);
      }
      for (const d of [...initialized].reverse()) {
        try {
          await d.module.dispose?.(ctx);
        } catch (error) {
          log.warn(`dispose do domínio ${d.name} falhou`, error);
        }
      }
      await disposeCtx();
    })();
    return closing;
  };

  try {
    for (const d of domainList) {
      await d.module.init?.(ctx);
      initialized.push(d);
      registerDomain(server, d.module.tools, ctx);
    }
    registerResources(server, options.resources ?? defaultResources, ctx);
    registerPrompts(server, options.prompts ?? defaultPrompts, ctx);
  } catch (error) {
    await close();
    throw error;
  }

  return { server, ctx, close };
}

/** Sobe o servidor em stdio e encerra de forma limpa (SIGINT/SIGTERM/stdin fechado). */
export async function main(): Promise<void> {
  const engine = await createEngineMcpServer();
  const { ctx } = engine;
  let exiting = false;
  const shutdown = (reason: string, code = 0): void => {
    if (exiting) return;
    exiting = true;
    ctx.log.info(`encerrando (${reason})`);
    const force = setTimeout(() => process.exit(code), 10_000);
    force.unref();
    void engine.close().finally(() => process.exit(code));
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.stdin.once("end", () => shutdown("stdin fechado"));
  process.stdin.once("close", () => shutdown("stdin fechado"));
  process.on("uncaughtException", (error) => {
    ctx.log.error("exceção não tratada", error);
    shutdown("uncaughtException", 1);
  });
  process.on("unhandledRejection", (error) => {
    ctx.log.error("promise rejeitada sem tratamento", error);
  });

  const transport = new StdioServerTransport();
  engine.server.server.onclose = () => shutdown("transporte fechado");
  await engine.server.connect(transport);
  ctx.log.info(`engine-mcp ${SERVER_VERSION} pronto em ${ctx.root}${ctx.config.readonly ? " (somente leitura)" : ""}`);
}

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main().catch((error: unknown) => {
    process.stderr.write(`[engine-mcp] falha ao iniciar: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exit(1);
  });
}
