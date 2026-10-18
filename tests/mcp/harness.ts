import { existsSync } from "node:fs";
/**
 * Harness dos testes do MCP da engine: cliente MCP real (SDK) ligado ao
 * servidor real por `InMemoryTransport`.
 *
 *   const t = await createTestClient();                 // repo real, somente leitura de fato
 *   const ping = await t.callTool("engine_ping");      // structuredContent
 *   await expect(t.callTool("job_status", { jobId: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
 *   await t.close();
 *
 *   const repo = await makeTempRepo();                  // cópia mínima p/ testes de escrita
 *   const t2 = await createTestClient({ root: repo.root });
 *   ...; await t2.close(); await repo.cleanup();
 */

import { cp, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { EngineMcpConfig } from "../../tools/mcp/src/core/config.ts";
import type { ToolContext } from "../../tools/mcp/src/core/context.ts";
import type { ToolErrorPayload } from "../../tools/mcp/src/core/errors.ts";
import { createLogger, silentLogger, type Logger } from "../../tools/mcp/src/core/log.ts";
import { ERROR_META_KEY, type PromptDef, type ResourceDef } from "../../tools/mcp/src/core/registry.ts";
import { createEngineMcpServer, type EngineMcpServer } from "../../tools/mcp/src/server.ts";
import type { NamedDomain } from "../../tools/mcp/src/tools/index.ts";

/** Raiz do repositório onde os testes rodam. */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
/** O jogo de exemplo existe? (o check de isolamento roda os testes SEM jogos). */
export const HAS_SAMPLE_GAME = existsSync(path.join(REPO_ROOT, "src", "projects", "physics-sandbox", "index.ts"));
/** Há um repositório git? (cópias temporárias não têm .git). */
export const HAS_GIT = existsSync(path.join(REPO_ROOT, ".git"));

/** Erro lançado por `callTool` quando a tool devolve `isError: true`. */
export class ToolCallError extends Error {
  readonly code: string;
  readonly hint?: string;
  readonly details?: unknown;
  readonly result: CallToolResult;
  constructor(payload: ToolErrorPayload, result: CallToolResult) {
    super(`[${payload.code}] ${payload.message}`);
    this.name = "ToolCallError";
    this.code = payload.code;
    if (payload.hint !== undefined) this.hint = payload.hint;
    if (payload.details !== undefined) this.details = payload.details;
    this.result = result;
  }
}

/** Extrai `{ code, message, hint? }` de um resultado de erro (ou `null`). */
export function errorOf(result: CallToolResult): ToolErrorPayload | null {
  if (!result.isError) return null;
  const meta = result._meta?.[ERROR_META_KEY] as ToolErrorPayload | undefined;
  if (meta && typeof meta.code === "string") return meta;
  const sc = result.structuredContent as ToolErrorPayload | undefined;
  if (sc && typeof sc.code === "string") return sc;
  const first = result.content?.[0];
  const text = first && first.type === "text" ? first.text : "";
  return { code: "UNKNOWN", message: text };
}

/** Texto concatenado do `content` (útil para conferir o resumo). */
export function textOf(result: CallToolResult): string {
  return (result.content ?? [])
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

export interface TestClientOptions {
  /** Raiz do repositório (padrão: o repo real). */
  readonly root?: string;
  /** Ambiente para a config (padrão: `process.env` sem ENGINE_MCP_*). */
  readonly env?: NodeJS.ProcessEnv;
  readonly config?: Partial<EngineMcpConfig>;
  /** Substitui os domínios (para testar o registry com tools falsas). */
  readonly domains?: readonly NamedDomain[];
  readonly resources?: readonly ResourceDef[];
  readonly prompts?: readonly PromptDef[];
  /** Padrão: silencioso (ENGINE_MCP_TEST_LOG=debug mostra o log). */
  readonly log?: Logger;
}

export interface TestClient {
  readonly client: Client;
  readonly engine: EngineMcpServer;
  readonly ctx: ToolContext;
  /** Chama a tool e devolve `structuredContent`; lança `ToolCallError` se `isError`. */
  callTool<T = any>(name: string, args?: Record<string, unknown>): Promise<T>;
  /** Resultado cru (`content`, `structuredContent`, `isError`, `_meta`). */
  callToolRaw(name: string, args?: Record<string, unknown>): Promise<CallToolResult>;
  listTools(): Promise<Tool[]>;
  close(): Promise<void>;
}

function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("ENGINE_MCP_")) env[k] = v;
  return env;
}

export async function createTestClient(options: TestClientOptions = {}): Promise<TestClient> {
  const level = process.env.ENGINE_MCP_TEST_LOG;
  const log = options.log ?? (level ? createLogger(level as "debug") : silentLogger);
  const engine = await createEngineMcpServer({
    env: options.env ?? cleanEnv(),
    root: options.root ?? REPO_ROOT,
    log,
    ...(options.config !== undefined ? { config: options.config } : {}),
    ...(options.domains !== undefined ? { domains: options.domains } : {}),
    ...(options.resources !== undefined ? { resources: options.resources } : {}),
    ...(options.prompts !== undefined ? { prompts: options.prompts } : {}),
  });
  const client = new Client({ name: "engine-mcp-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await engine.server.connect(serverTransport);
  await client.connect(clientTransport);

  const callToolRaw = async (name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> =>
    (await client.callTool({ name, arguments: args })) as CallToolResult;

  return {
    client,
    engine,
    ctx: engine.ctx,
    callToolRaw,
    async callTool(name, args) {
      const result = await callToolRaw(name, args);
      const error = errorOf(result);
      if (error) throw new ToolCallError(error, result);
      return result.structuredContent as never;
    },
    async listTools() {
      return (await client.listTools()).tools;
    },
    async close() {
      await client.close().catch(() => undefined);
      await engine.close();
    },
  };
}

export interface TempRepo {
  /** Raiz absoluta (realpath) do repositório temporário. */
  readonly root: string;
  cleanup(): Promise<void>;
}

export interface TempRepoOptions {
  /** Caminhos extras (relativos ao repo real) a copiar, ex.: ["tsconfig.json", "scripts/architecture"]. */
  readonly copy?: readonly string[];
}

/**
 * Repositório temporário mínimo para testes de escrita: `package.json`
 * (name "projeto1"), `src/projects/_template` e `docs/ai` copiados do real.
 */
export async function makeTempRepo(options: TempRepoOptions = {}): Promise<TempRepo> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "engine-mcp-repo-")));
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "projeto1", version: "0.0.0-test", private: true, type: "module" }, null, 2) + "\n",
  );
  const copies = ["src/projects/_template", "docs/ai", ...(options.copy ?? [])];
  for (const rel of copies) {
    await cp(path.join(REPO_ROOT, rel), path.join(root, rel), { recursive: true, dereference: false });
  }
  return {
    root,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

/** `true` se o processo existe. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Espera `predicate()` ficar verdadeiro (poll a cada 25 ms). */
export async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 5000, label = "condição"): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timeout esperando ${label}`);
}
