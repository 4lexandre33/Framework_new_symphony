/**
 * Registro de tools, resources e prompts com envelope padronizado (SPEC §1.3).
 *
 * Sucesso: `{ content: [{ type: "text", text: resumo + JSON }, ...imagens], structuredContent }`.
 * Erro:    `{ isError: true, content: [{ type: "text", text }], _meta: { "engine-mcp/error": { code, message, hint? } } }`
 *          + `structuredContent: { code, message, hint? }` quando a tool NÃO declara `output`
 *          (o cliente do SDK validaria o erro contra o outputSchema e recusaria).
 */

import type { McpServer, RegisteredPrompt, RegisteredResource, RegisteredResourceTemplate, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import {
  ErrorCode as RpcErrorCode,
  McpError,
  type CallToolResult,
  type GetPromptResult,
  type ReadResourceResult,
  type ServerNotification,
  type ServerRequest,
  type ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ToolContext } from "./context.ts";
import { McpToolError, type ToolErrorPayload } from "./errors.ts";

/* ============================================================================
 * Tipos
 * ========================================================================== */

export type ZodShape = z.ZodRawShape;
/** Entrada: shape cru (`{ id: z.string() }`, vira objeto estrito) ou `z.object(...)`. */
export type InputSpec = ZodShape | z.ZodObject<ZodShape>;
/** Saída: shape cru (vira `z.object`) ou qualquer `z.object`/`z.looseObject` (campos extras permitidos). */
export type OutputSpec = ZodShape | z.ZodObject<ZodShape, z.core.$ZodObjectConfig>;

export type InferSpec<S> = S extends z.ZodObject<ZodShape, z.core.$ZodObjectConfig>
  ? z.output<S>
  : S extends ZodShape
    ? z.output<z.ZodObject<S>>
    : never;

/** Versão somente leitura (aceita objetos com `readonly` vindos do domínio). */
export type DeepReadonly<T> = T extends readonly (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

/** Saída inferida do `output` (ou objeto livre), aceitando `readonly`. */
export type InferOutput<O> = O extends OutputSpec ? DeepReadonly<InferSpec<O>> : object;

export type SdkExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

/** Terceiro argumento de `run`: cancelamento e progresso da chamada MCP. */
export interface ToolCall {
  /** Abortado quando o cliente cancela a requisição. */
  readonly signal: AbortSignal;
  /** Envia `notifications/progress` se o cliente pediu (`_meta.progressToken`). */
  progress(progress: number, total?: number, message?: string): Promise<void>;
  /** Acesso cru ao `extra` do SDK (sessionId, requestId, sendNotification…). */
  readonly extra: SdkExtra;
}

export interface ToolImage {
  /** PNG/JPEG em base64 (sem prefixo data:). */
  readonly data: string;
  readonly mimeType: string;
}

const RESULT_TAG: unique symbol = Symbol.for("engine-mcp.tool-result");

export interface ToolResult<O> {
  readonly [RESULT_TAG]: true;
  readonly data: O;
  /** Linha de resumo (substitui `summarize`). */
  readonly summary?: string;
  /** Imagens anexadas ao `content` (ex.: screenshot). */
  readonly images?: readonly ToolImage[];
}

/** Resultado rico: dados + resumo + imagens. `run` também pode devolver só os dados. */
export function toolResult<O>(init: { data: O; summary?: string; images?: readonly ToolImage[] }): ToolResult<O> {
  return { [RESULT_TAG]: true, ...init };
}

function isToolResult(value: unknown): value is ToolResult<unknown> {
  return typeof value === "object" && value !== null && (value as Record<PropertyKey, unknown>)[RESULT_TAG] === true;
}

type MaybePromise<T> = T | Promise<T>;

/**
 * Comportamento da tool com `ENGINE_MCP_READONLY=1` (SPEC §1.2), checado no
 * registry ANTES de `run` (depois da validação da entrada):
 * - `"allow"`: não grava nada no disco nem roda processo que grave;
 * - `"deny"`: recusada com `READONLY`;
 * - função: `null` = permitido; texto = motivo da recusa (depende dos args).
 * Padrão: `"allow"` se `annotations.readOnlyHint === true`, senão `"deny"`.
 */
export type ReadonlyPolicy<A = never> = "allow" | "deny" | ((args: A, ctx: ToolContext) => string | null);

export interface ToolSpec<I extends InputSpec, O extends OutputSpec | undefined> {
  /** snake_case, único no servidor (ex.: `project_list`). */
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  /** Padrão: sem argumentos. */
  readonly input?: I;
  /** Se presente vira `outputSchema` e a saída é validada. */
  readonly output?: O;
  readonly annotations?: ToolAnnotations;
  /** Ver `ReadonlyPolicy`. Obrigatório (na prática) para tools sem `readOnlyHint: true` que são seguras em modo somente leitura. */
  readonly readonlyPolicy?: ReadonlyPolicy<InferSpec<I>>;
  /** Resumo de uma linha para o `content` de texto. Padrão: `"<name>: ok"`. */
  readonly summarize?: (data: InferOutput<O>, args: InferSpec<I>) => string;
  readonly run: (
    args: InferSpec<I>,
    ctx: ToolContext,
    call: ToolCall,
  ) => MaybePromise<InferOutput<O> | ToolResult<InferOutput<O>>>;
}

/** Forma apagada (para arrays heterogêneos `ToolDef[]`). */
export interface ToolDef {
  readonly kind: "tool";
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly inputSchema: z.ZodObject<ZodShape>;
  readonly outputSchema?: z.ZodObject<ZodShape>;
  readonly annotations?: ToolAnnotations;
  readonly readonlyPolicy?: ReadonlyPolicy;
  readonly summarize?: (data: never, args: never) => string;
  readonly run: (args: never, ctx: ToolContext, call: ToolCall) => unknown;
}

export const TOOL_NAME_RE = /^[a-z][a-z0-9_]{1,63}$/;

function toObjectSchema(spec: InputSpec | OutputSpec | undefined, strict: boolean): z.ZodObject<ZodShape> {
  if (spec === undefined) return strict ? z.strictObject({}) : z.object({});
  if (spec instanceof z.ZodObject) return spec as unknown as z.ZodObject<ZodShape>;
  return strict ? z.strictObject(spec as ZodShape) : z.object(spec as ZodShape);
}

/** Define uma tool. `input` como shape cru vira `z.strictObject` (chave desconhecida = erro). */
export function defineTool<I extends InputSpec = {}, O extends OutputSpec | undefined = undefined>(spec: ToolSpec<I, O>): ToolDef {
  if (!TOOL_NAME_RE.test(spec.name)) {
    throw new Error(`nome de tool inválido: ${spec.name} (use snake_case)`);
  }
  return {
    kind: "tool",
    name: spec.name,
    ...(spec.title !== undefined ? { title: spec.title } : {}),
    description: spec.description,
    inputSchema: toObjectSchema(spec.input, true),
    ...(spec.output !== undefined ? { outputSchema: toObjectSchema(spec.output, false) } : {}),
    ...(spec.annotations !== undefined ? { annotations: spec.annotations } : {}),
    ...(spec.readonlyPolicy !== undefined ? { readonlyPolicy: spec.readonlyPolicy as ReadonlyPolicy } : {}),
    ...(spec.summarize !== undefined ? { summarize: spec.summarize as ToolDef["summarize"] } : {}),
    run: spec.run as ToolDef["run"],
  };
}

/** Política efetiva em modo somente leitura (padrão derivado de `readOnlyHint`). */
export function effectiveReadonlyPolicy(def: ToolDef): ReadonlyPolicy {
  return def.readonlyPolicy ?? (def.annotations?.readOnlyHint === true ? "allow" : "deny");
}

/** Motivo da recusa em modo somente leitura, ou `null` se a chamada é permitida. Exportado para testes. */
export function readonlyDenial(def: ToolDef, args: unknown, ctx: ToolContext): string | null {
  const policy = effectiveReadonlyPolicy(def);
  if (policy === "allow") return null;
  if (policy === "deny") return "a tool grava arquivos ou roda processos que podem gravar";
  return (policy as (a: unknown, c: ToolContext) => string | null)(args, ctx);
}

/* ============================================================================
 * Envelope
 * ========================================================================== */

export const ERROR_META_KEY = "engine-mcp/error";
const MAX_TEXT_JSON = 200_000;

function toJsonObject(value: unknown): Record<string, unknown> {
  const normalized: unknown = value === undefined ? {} : JSON.parse(JSON.stringify(value));
  if (Array.isArray(normalized)) return { items: normalized };
  if (typeof normalized !== "object" || normalized === null) return { value: normalized };
  return normalized as Record<string, unknown>;
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 10)
    .map((i) => `${i.path.length ? i.path.join(".") : "(raiz)"}: ${i.message}`)
    .join("; ");
}

/** Converte qualquer exceção no payload padronizado. */
export function toErrorPayload(error: unknown): ToolErrorPayload {
  if (error instanceof McpToolError) return error.toPayload();
  if (error instanceof z.ZodError) {
    return { code: "SCHEMA_INVALID", message: formatIssues(error), details: { issues: error.issues.slice(0, 50) } };
  }
  const errno = (error as NodeJS.ErrnoException | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  if (errno === "ENOENT") return { code: "NOT_FOUND", message };
  return { code: "INTERNAL", message };
}

export function errorResult(payload: ToolErrorPayload, withStructured: boolean): CallToolResult {
  const head = `Erro [${payload.code}]: ${payload.message}${payload.hint ? `\nDica: ${payload.hint}` : ""}`;
  const json = JSON.stringify({ code: payload.code, message: payload.message, ...(payload.hint ? { hint: payload.hint } : {}) });
  const structured = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
  return {
    isError: true,
    content: [{ type: "text", text: `${head}\n${json}` }],
    _meta: { [ERROR_META_KEY]: structured },
    ...(withStructured ? { structuredContent: structured } : {}),
  };
}

export function successResult(name: string, data: Record<string, unknown>, summary: string | undefined, images: readonly ToolImage[] = []): CallToolResult {
  let json = JSON.stringify(data, null, 2);
  if (json.length > MAX_TEXT_JSON) json = json.slice(0, MAX_TEXT_JSON) + "\n… (truncado; dados completos em structuredContent)";
  return {
    content: [
      { type: "text", text: `${summary ?? `${name}: ok`}\n\n${json}` },
      ...images.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType })),
    ],
    structuredContent: data,
  };
}

function makeCall(extra: SdkExtra): ToolCall {
  return {
    signal: extra.signal,
    extra,
    progress: async (progress, total, message) => {
      const token = extra._meta?.progressToken;
      if (token === undefined) return;
      await extra.sendNotification({
        method: "notifications/progress",
        params: { progressToken: token, progress, ...(total !== undefined ? { total } : {}), ...(message !== undefined ? { message } : {}) },
      });
    },
  };
}

/** Executa uma tool com validação de entrada/saída e envelope. Exportado para testes. */
export async function invokeTool(def: ToolDef, rawArgs: unknown, ctx: ToolContext, extra: SdkExtra): Promise<CallToolResult> {
  const withStructuredError = def.outputSchema === undefined;
  try {
    const parsed = def.inputSchema.safeParse(rawArgs ?? {});
    if (!parsed.success) {
      throw new McpToolError("INVALID_INPUT", `entrada inválida para ${def.name}: ${formatIssues(parsed.error)}`, "Confira o inputSchema da tool em tools/list.", {
        issues: parsed.error.issues.slice(0, 50),
      });
    }
    if (ctx.config.readonly) {
      const reason = readonlyDenial(def, parsed.data, ctx);
      if (reason !== null) {
        throw new McpToolError(
          "READONLY",
          `${def.name} recusada: servidor em modo somente leitura (ENGINE_MCP_READONLY=1) — ${reason}`,
          "Rode o MCP sem ENGINE_MCP_READONLY para usar esta tool (ou escolha uma variante de leitura indicada na descrição).",
        );
      }
    }
    const out = await (def.run as (a: unknown, c: ToolContext, k: ToolCall) => unknown)(parsed.data, ctx, makeCall(extra));
    const rich = isToolResult(out) ? out : null;
    const data = toJsonObject(rich ? rich.data : out);
    if (def.outputSchema) {
      const check = def.outputSchema.safeParse(data);
      if (!check.success) {
        throw new McpToolError("INTERNAL", `saída de ${def.name} não bate com o outputSchema: ${formatIssues(check.error)}`, "Bug na tool; reporte.");
      }
    }
    const summary =
      rich?.summary ??
      (def.summarize ? (def.summarize as (d: unknown, a: unknown) => string)(rich ? rich.data : out, parsed.data) : undefined);
    return successResult(def.name, data, summary, rich?.images);
  } catch (error) {
    const payload = toErrorPayload(error);
    if (payload.code === "INTERNAL") ctx.log.error(`tool ${def.name} falhou`, error);
    else ctx.log.debug(`tool ${def.name}: ${payload.code} ${payload.message}`);
    return errorResult(payload, withStructuredError);
  }
}

/**
 * O SDK valida a entrada antes do callback e devolve erro só em texto.
 * Desligamos essa validação nesta instância para que `invokeTool` produza
 * `INVALID_INPUT` estruturado (a validação continua, com o mesmo schema).
 */
export function useStructuredInputErrors(server: McpServer): void {
  const target = server as unknown as { validateToolInput?: (tool: unknown, args: unknown, name: string) => Promise<unknown> };
  if (typeof target.validateToolInput === "function") {
    target.validateToolInput = async (_tool, args) => args ?? {};
  }
}

/** Registra as tools de um domínio no servidor. */
export function registerDomain(server: McpServer, tools: readonly ToolDef[], ctx: ToolContext): RegisteredTool[] {
  return tools.map((def) =>
    server.registerTool(
      def.name,
      {
        ...(def.title !== undefined ? { title: def.title } : {}),
        description: def.description,
        inputSchema: def.inputSchema,
        ...(def.outputSchema !== undefined ? { outputSchema: def.outputSchema } : {}),
        ...(def.annotations !== undefined ? { annotations: def.annotations } : {}),
      },
      (args: unknown, extra: SdkExtra) => invokeTool(def, args, ctx, extra),
    ),
  );
}

/* ============================================================================
 * Resources
 * ========================================================================== */

export interface ResourceListing {
  readonly uri: string;
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly mimeType?: string;
}

/** Texto puro, `{ text }`, `{ blob }` (base64) ou o `ReadResourceResult` completo. */
export type ResourceContent =
  | string
  | { readonly text: string; readonly mimeType?: string }
  | { readonly blob: string; readonly mimeType?: string }
  | ReadResourceResult;

export interface ResourceSpec {
  readonly name: string;
  /** URI fixa (`engine://docs/RULES`) ou template RFC 6570 (`engine://module/{key}`). */
  readonly uri: string;
  readonly title?: string;
  readonly description?: string;
  readonly mimeType?: string;
  /** Só para templates: enumera os recursos concretos (resources/list). */
  readonly list?: (ctx: ToolContext) => MaybePromise<readonly ResourceListing[]>;
  /** Só para templates: autocompletar variáveis. */
  readonly complete?: Readonly<Record<string, (value: string, ctx: ToolContext) => MaybePromise<string[]>>>;
  /** `vars` = variáveis do template (vazio para URI fixa). Lance `McpToolError` para erros. */
  readonly read: (uri: URL, vars: Readonly<Record<string, string>>, ctx: ToolContext) => MaybePromise<ResourceContent>;
}

export interface ResourceDef extends ResourceSpec {
  readonly kind: "resource";
}

export function defineResource(spec: ResourceSpec): ResourceDef {
  return { kind: "resource", ...spec };
}

function toReadResult(uri: URL, content: ResourceContent, mimeType: string | undefined): ReadResourceResult {
  if (typeof content === "string") return { contents: [{ uri: uri.href, text: content, ...(mimeType ? { mimeType } : {}) }] };
  if ("contents" in content) return content;
  const mt = content.mimeType ?? mimeType;
  if ("blob" in content) return { contents: [{ uri: uri.href, blob: content.blob, ...(mt ? { mimeType: mt } : {}) }] };
  return { contents: [{ uri: uri.href, text: content.text, ...(mt ? { mimeType: mt } : {}) }] };
}

function toRpcError(error: unknown): McpError {
  const payload = toErrorPayload(error);
  return new McpError(
    payload.code === "INTERNAL" ? RpcErrorCode.InternalError : RpcErrorCode.InvalidParams,
    `[${payload.code}] ${payload.message}${payload.hint ? ` — ${payload.hint}` : ""}`,
    payload,
  );
}

export function registerResources(
  server: McpServer,
  resources: readonly ResourceDef[],
  ctx: ToolContext,
): Array<RegisteredResource | RegisteredResourceTemplate> {
  return resources.map((def) => {
    const metadata = {
      ...(def.title !== undefined ? { title: def.title } : {}),
      ...(def.description !== undefined ? { description: def.description } : {}),
      ...(def.mimeType !== undefined ? { mimeType: def.mimeType } : {}),
    };
    const read = async (uri: URL, vars: Record<string, string>): Promise<ReadResourceResult> => {
      try {
        return toReadResult(uri, await def.read(uri, vars, ctx), def.mimeType);
      } catch (error) {
        if (toErrorPayload(error).code === "INTERNAL") ctx.log.error(`resource ${def.name} falhou`, error);
        throw toRpcError(error);
      }
    };
    if (!def.uri.includes("{")) {
      return server.registerResource(def.name, def.uri, metadata, (uri) => read(uri, {}));
    }
    const complete = def.complete
      ? Object.fromEntries(Object.entries(def.complete).map(([k, fn]) => [k, async (value: string) => fn(value, ctx)]))
      : undefined;
    const list = def.list;
    const template = new ResourceTemplate(def.uri, {
      list: list
        ? async () => ({
            resources: (await list(ctx)).map((r) => ({ ...r })),
          })
        : undefined,
      ...(complete ? { complete } : {}),
    });
    return server.registerResource(def.name, template, metadata, (uri, variables) => {
      const vars: Record<string, string> = {};
      for (const [k, v] of Object.entries(variables)) vars[k] = Array.isArray(v) ? v.join("/") : v;
      return read(uri, vars);
    });
  });
}

/* ============================================================================
 * Prompts
 * ========================================================================== */

/** Argumentos de prompt são sempre texto no MCP. */
export type PromptArgs = Record<string, z.ZodString | z.ZodOptional<z.ZodString>>;

export interface PromptSpec<A extends PromptArgs> {
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly args?: A;
  /** Texto (vira uma mensagem `user`) ou o `GetPromptResult` completo. */
  readonly render: (args: z.output<z.ZodObject<A>>, ctx: ToolContext) => MaybePromise<string | GetPromptResult>;
}

export interface PromptDef {
  readonly kind: "prompt";
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly args?: PromptArgs;
  readonly render: (args: never, ctx: ToolContext) => MaybePromise<string | GetPromptResult>;
}

export function definePrompt<A extends PromptArgs = {}>(spec: PromptSpec<A>): PromptDef {
  return { kind: "prompt", ...spec, render: spec.render as PromptDef["render"] };
}

export function registerPrompts(server: McpServer, prompts: readonly PromptDef[], ctx: ToolContext): RegisteredPrompt[] {
  return prompts.map((def) => {
    const config = {
      ...(def.title !== undefined ? { title: def.title } : {}),
      ...(def.description !== undefined ? { description: def.description } : {}),
      ...(def.args !== undefined ? { argsSchema: def.args } : {}),
    };
    const render = async (args: unknown): Promise<GetPromptResult> => {
      try {
        const out = await (def.render as (a: unknown, c: ToolContext) => MaybePromise<string | GetPromptResult>)(args ?? {}, ctx);
        if (typeof out !== "string") return out;
        return {
          ...(def.description !== undefined ? { description: def.description } : {}),
          messages: [{ role: "user", content: { type: "text", text: out } }],
        };
      } catch (error) {
        throw toRpcError(error);
      }
    };
    const cb = ((...cbArgs: unknown[]) => (def.args !== undefined ? render(cbArgs[0]) : render({}))) as Parameters<McpServer["registerPrompt"]>[2];
    return server.registerPrompt(def.name, config, cb);
  });
}
