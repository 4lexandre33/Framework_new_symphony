/**
 * Domínio `runtime` — T6: jogo rodando via DevBridge (SPEC §3.4).
 *
 * - O servidor WebSocket (`runtime/bridge-server.ts`) só abre na primeira
 *   tool que precisa dele (`runtime_launch` / `runtime_connect_info`); `init`
 *   não abre sockets. Porta: `ENGINE_MCP_BRIDGE_PORT` (47100), com fallback
 *   para porta livre se ocupada.
 * - Cada tool de jogo aceita `sessionId` opcional: sem ele, usa a única sessão
 *   conectada (NO_RUNTIME se nenhuma, INVALID_INPUT se várias).
 * - Erros do jogo: INVALID_PARAMS→INVALID_INPUT, NOT_FOUND→NOT_FOUND,
 *   COMMAND_NOT_ALLOWED→COMMAND_NOT_ALLOWED, demais→BRIDGE_ERROR
 *   (`details.code` = código do DevBridge). Sem resposta → BRIDGE_TIMEOUT.
 * - Timeouts: `ENGINE_MCP_BRIDGE_TIMEOUT_MS` (15 s), screenshot 30 s.
 */

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { z } from "zod";
import {
  validatePrefabDocument,
  validateSceneDocument,
  type PrefabDocument,
  type SceneDocumentError,
} from "../../../../src/contracts/world/scene-document.ts";
import type { ToolContext } from "../core/context.ts";
import { McpToolError } from "../core/errors.ts";
import { PROJECT_ID_RE } from "../core/paths.ts";
import { defineTool, toolResult, type ToolCall, type ToolDef } from "../core/registry.ts";
import {
  BridgeRemoteError,
  BridgeServer,
  DEFAULT_BRIDGE_TIMEOUT_MS,
  DEFAULT_SCREENSHOT_TIMEOUT_MS,
  type BridgeSession,
} from "../runtime/bridge-server.ts";
import { launchRuntime, type LaunchedRuntime } from "../runtime/launcher.ts";
import {
  DEVBRIDGE_MAX_LIST_LIMIT,
  DEVBRIDGE_MAX_SCREENSHOT_WIDTH,
  DEVBRIDGE_MAX_STEP_TICKS,
  DEVBRIDGE_MAX_TAIL_LIMIT,
  type DevBridgeMethod,
  type ScreenshotResult,
} from "../runtime/protocol.ts";

/* ============================================================================
 * Estado por servidor
 * ========================================================================== */

export interface RuntimeOptions {
  /** Timeout padrão por requisição ao jogo (ms). */
  readonly requestTimeoutMs: number;
  readonly screenshotTimeoutMs: number;
  /** Porta do bridge (padrão: `ctx.config.bridgePort`; 0 = livre). */
  readonly bridgePort?: number;
  /** Pastas extras onde procurar o Playwright (padrão: /opt/npm-tools). */
  readonly playwrightDirs?: readonly string[];
}

interface RuntimeState {
  options: RuntimeOptions;
  bridge: BridgeServer | null;
  readonly launches: Map<string, LaunchedRuntime>;
  readonly ctx: ToolContext;
}

const states = new WeakMap<ToolContext, RuntimeState>();

function envMs(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 100 && n <= 3_600_000 ? n : fallback;
}

function state(ctx: ToolContext): RuntimeState {
  let st = states.get(ctx);
  if (!st) {
    st = {
      ctx,
      bridge: null,
      launches: new Map(),
      options: {
        requestTimeoutMs: envMs("ENGINE_MCP_BRIDGE_TIMEOUT_MS", DEFAULT_BRIDGE_TIMEOUT_MS),
        screenshotTimeoutMs: envMs("ENGINE_MCP_SCREENSHOT_TIMEOUT_MS", DEFAULT_SCREENSHOT_TIMEOUT_MS),
      },
    };
    states.set(ctx, st);
  }
  return st;
}

/**
 * Ajusta opções do runtime deste servidor (testes: timeouts curtos, porta 0,
 * Playwright ausente). Só vale antes do bridge iniciar para `bridgePort`.
 */
export function configureRuntime(ctx: ToolContext, options: Partial<RuntimeOptions>): void {
  const st = state(ctx);
  st.options = { ...st.options, ...options };
}

/** Acesso ao bridge (testes). `null` se ainda não foi criado. */
export function getBridgeServer(ctx: ToolContext): BridgeServer | null {
  return states.get(ctx)?.bridge ?? null;
}

function bridgeOf(st: RuntimeState): BridgeServer {
  st.bridge ??= new BridgeServer({
    port: st.options.bridgePort ?? st.ctx.config.bridgePort,
    requestTimeoutMs: st.options.requestTimeoutMs,
    log: st.ctx.log.child("bridge"),
  });
  return st.bridge;
}

export function init(ctx: ToolContext): void {
  state(ctx); // sem sockets: o bridge sobe sob demanda
}

export async function dispose(ctx: ToolContext): Promise<void> {
  const st = states.get(ctx);
  if (!st) return;
  await Promise.all([...st.launches.values()].map((l) => l.stop().catch(() => undefined)));
  st.launches.clear();
  await st.bridge?.dispose();
  st.bridge = null;
  states.delete(ctx);
}

/* ============================================================================
 * Sessões e chamadas
 * ========================================================================== */

const NO_RUNTIME_HINT = "Use runtime_launch { id } (headless) ou runtime_connect_info { id } e abra o jogo; runtime_status lista as sessões.";

function resolveSession(ctx: ToolContext, sessionId: string | undefined, preferProject?: string): BridgeSession {
  const bridge = states.get(ctx)?.bridge ?? null;
  const sessions = bridge?.list() ?? [];
  if (sessionId !== undefined) {
    const found = bridge?.get(sessionId) ?? null;
    if (!found) {
      throw new McpToolError("NO_RUNTIME", `sessão ${sessionId} não está conectada`, NO_RUNTIME_HINT, {
        sessions: sessions.map((s) => s.sessionId),
      });
    }
    return found;
  }
  if (sessions.length === 0) throw new McpToolError("NO_RUNTIME", "nenhum jogo conectado ao DevBridge", NO_RUNTIME_HINT);
  if (sessions.length === 1) return sessions[0]!;
  if (preferProject !== undefined) {
    const same = sessions.filter((s) => s.project === preferProject);
    if (same.length === 1) return same[0]!;
  }
  throw new McpToolError(
    "INVALID_INPUT",
    `há ${sessions.length} sessões conectadas; informe sessionId (${sessions.map((s) => s.sessionId).join(", ")})`,
    "runtime_status lista as sessões com projeto e status.",
    { sessions: sessions.map((s) => ({ sessionId: s.sessionId, project: s.project })) },
  );
}

const REMOTE_CODE_MAP: Readonly<Record<string, string>> = {
  INVALID_PARAMS: "INVALID_INPUT",
  NOT_FOUND: "NOT_FOUND",
  COMMAND_NOT_ALLOWED: "COMMAND_NOT_ALLOWED",
};

const REMOTE_HINTS: Readonly<Record<string, string>> = {
  NOT_AVAILABLE: "O jogo não tem esse serviço/plugin (ou o loop precisa estar pausado). Veja kernel_inspect.",
  RESULT_TOO_LARGE: "Use limit/maxWidth menores.",
  UNKNOWN_METHOD: "Versões diferentes do DevBridge e do MCP; recarregue o jogo.",
  NOT_FOUND: "Confira ids com world_entities / camera_get.",
};

/** Converte erro do bridge em `McpToolError`. Exportado para testes. */
export function mapBridgeError(error: unknown, method: string, sessionId: string): unknown {
  if (!(error instanceof BridgeRemoteError)) return error;
  const code = REMOTE_CODE_MAP[error.bridgeCode] ?? "BRIDGE_ERROR";
  return new McpToolError(code, `${method}: ${error.message}`, REMOTE_HINTS[error.bridgeCode], {
    code: error.bridgeCode,
    method,
    sessionId,
  });
}

async function callGame<T = unknown>(
  session: BridgeSession,
  method: DevBridgeMethod,
  params: unknown,
  call: ToolCall,
  timeoutMs?: number,
): Promise<T> {
  try {
    return await session.request<T>(method, params, { signal: call.signal, ...(timeoutMs !== undefined ? { timeoutMs } : {}) });
  } catch (error) {
    throw mapBridgeError(error, method, session.sessionId);
  }
}

/** Remove chaves `undefined` (o DevBridge recusa chaves desconhecidas, não ausentes). */
function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as Partial<T>;
}

function requireProjectDir(ctx: ToolContext, id: string): void {
  if (!existsSync(ctx.paths.resolve(`src/projects/${id}/index.ts`))) {
    throw new McpToolError("NOT_FOUND", `jogo ${id} não existe (src/projects/${id}/index.ts)`, "Use project_list para ver os jogos.");
  }
}

/* ============================================================================
 * Schemas
 * ========================================================================== */

const sessionIdInput = z
  .string()
  .min(1)
  .max(128)
  .optional()
  .describe("id da sessão (runtime_status). Opcional se houver só um jogo conectado.");
const idInput = z
  .string()
  .regex(PROJECT_ID_RE, "id inválido: use minúsculas, dígitos e hífen")
  .describe("id do jogo = pasta em src/projects/ (ex.: physics-sandbox)");
const entityIdInput = z.string().min(1).max(128).describe("id da entidade no world");
const num = z.number();
const vec3 = z.object({ x: num, y: num, z: num }).strict();
const partialVec3 = z.object({ x: num.optional(), y: num.optional(), z: num.optional() }).strict();
const quat = z.object({ x: num, y: num, z: num, w: num }).strict().describe("quaternion {x,y,z,w}");
const tags = z.array(z.string().min(1).max(128)).max(64);
const customData = z.record(z.string(), z.unknown()).describe("dados livres JSON da entidade (customData)");
const tailSince = z.number().int().min(0).optional().describe("só entradas com seq > since (use lastSeq da chamada anterior)");
const tailLimit = z.number().int().min(1).max(DEVBRIDGE_MAX_TAIL_LIMIT).optional().describe(`máximo de entradas (1..${DEVBRIDGE_MAX_TAIL_LIMIT}, padrão 100; as mais recentes)`);

const loopStatsSchema = z.object({
  available: z.boolean(),
  fps: z.number(),
  targetFps: z.number(),
  tickRate: z.number(),
  isPaused: z.boolean(),
  isHidden: z.boolean(),
  runningTimeSeconds: z.number(),
});

const entitySnapshotSchema = z.object({
  entityId: z.string(),
  type: z.string(),
  position: vec3,
  rotation: quat,
  scale: vec3,
  tags: z.array(z.string()),
  customData: z.unknown(),
  distance: z.number().optional(),
});

const sessionInfoSchema = z.object({
  sessionId: z.string(),
  project: z.string().nullable(),
  kernelApiVersion: z.string(),
  userAgent: z.string(),
  connectedAt: z.string(),
  uptimeMs: z.number(),
  launchId: z.string().nullable(),
  launched: z.boolean(),
  pendingRequests: z.number(),
  lastKernelStatus: z.string().nullable(),
  lastKernelStatusAt: z.string().nullable(),
  fps: z.number().nullable().optional(),
  isPaused: z.boolean().nullable().optional(),
});

/* ============================================================================
 * Tools de ciclo de vida
 * ========================================================================== */

const lifecycleTools: ToolDef[] = [
  defineTool({
    name: "runtime_launch",
    title: "Rodar um jogo (vite + Chromium)",
    description:
      "Sobe o Vite numa porta livre com VITE_PROJECT=<id> e abre o jogo num Chromium (Playwright; headless por padrão) já ligado ao DevBridge. " +
      "Espera o jogo conectar (padrão 60 s) e devolve sessionId para as tools kernel_inspect, world_*, screenshot etc. " +
      "Sem Playwright → PLAYWRIGHT_MISSING (use runtime_connect_info). Feche com runtime_stop.",
    input: {
      id: idInput,
      headless: z.boolean().optional().describe("padrão true; false abre janela (precisa de display)"),
      width: z.number().int().min(64).max(4096).optional().describe("largura do viewport em px (padrão 1280)"),
      height: z.number().int().min(64).max(4096).optional().describe("altura do viewport em px (padrão 720)"),
      timeoutMs: z.number().int().min(5000).max(600_000).optional().describe("tempo máximo de boot (vite + jogo conectar), padrão 60000"),
    },
    output: {
      sessionId: z.string(),
      launchId: z.string(),
      url: z.string(),
      vitePort: z.number(),
      vitePid: z.number().nullable(),
      bridgePort: z.number(),
      headless: z.boolean(),
      browserVersion: z.string().nullable(),
    },
    summarize: (o) => `jogo rodando: sessão ${o.sessionId} (vite :${o.vitePort}, bridge :${o.bridgePort})`,
    run: async ({ id, headless, width, height, timeoutMs }, ctx, call) => {
      const st = state(ctx);
      const { launch, session } = await launchRuntime(ctx, bridgeOf(st), {
        id,
        headless: headless ?? true,
        width: width ?? 1280,
        height: height ?? 720,
        bootTimeoutMs: timeoutMs ?? 60_000,
        signal: call.signal,
        ...(st.options.playwrightDirs ? { playwrightDirs: st.options.playwrightDirs } : {}),
        progress: (step, message) => void call.progress(step, 4, message).catch(() => undefined),
      });
      st.launches.set(launch.info.launchId, launch);
      void refreshKernelStatus(session, st.options.requestTimeoutMs);
      return {
        sessionId: session.sessionId,
        launchId: launch.info.launchId,
        url: launch.info.url,
        vitePort: launch.info.vitePort,
        vitePid: launch.info.vitePid,
        bridgePort: launch.info.bridgePort,
        headless: launch.info.headless,
        browserVersion: launch.info.browserVersion,
      };
    },
  }),

  defineTool({
    name: "runtime_connect_info",
    title: "Como conectar um jogo aberto à mão",
    description:
      "Inicia o servidor do DevBridge (se preciso) e devolve a URL com token para abrir o jogo no navegador (npm run dev) " +
      "e as variáveis VITE_DEVBRIDGE_URL/VITE_DEVBRIDGE_TOKEN para `tauri dev`. Depois de abrir, use runtime_status.",
    input: { id: idInput },
    output: {
      project: z.string(),
      bridgeUrl: z.string(),
      bridgePort: z.number(),
      bridgePortFallback: z.boolean(),
      token: z.string(),
      url: z.string(),
      browser: z.object({ command: z.string(), env: z.record(z.string(), z.string()), url: z.string() }),
      tauri: z.object({ command: z.string(), env: z.record(z.string(), z.string()) }),
    },
    summarize: (o) => `bridge em ${o.bridgeUrl}${o.bridgePortFallback ? " (porta padrão ocupada)" : ""}; abra ${o.url.replace(o.token, "<token>")}`,
    run: async ({ id }, ctx) => {
      requireProjectDir(ctx, id);
      const bridge = bridgeOf(state(ctx));
      const listen = await bridge.start();
      const token = bridge.mainToken;
      const url = `http://localhost:1420/?project=${encodeURIComponent(id)}&devbridge=${encodeURIComponent(listen.url)}&devtoken=${encodeURIComponent(token)}`;
      return {
        project: id,
        bridgeUrl: listen.url,
        bridgePort: listen.port,
        bridgePortFallback: listen.fallback,
        token,
        url,
        browser: { command: "npm run dev", env: { VITE_PROJECT: id }, url },
        tauri: {
          command: `node scripts/tauri-project-config.mjs ${id} --dev`,
          env: { VITE_DEVBRIDGE_URL: listen.url, VITE_DEVBRIDGE_TOKEN: token },
        },
      };
    },
  }),

  defineTool({
    name: "runtime_status",
    title: "Sessões de jogo conectadas",
    description:
      "Lista as sessões do DevBridge (projeto, conectado desde, lançado pelo MCP?, último status do kernel, fps) e os lançamentos ativos. " +
      "Não abre o servidor do bridge se ele ainda não existe.",
    input: {
      refresh: z.boolean().optional().describe("padrão true: consulta fps/status de cada sessão (timeout curto)"),
    },
    output: {
      bridge: z.object({ url: z.string(), port: z.number(), requestedPort: z.number(), fallback: z.boolean() }).nullable(),
      sessions: z.array(sessionInfoSchema),
      launches: z.array(
        z.object({
          launchId: z.string(),
          project: z.string(),
          url: z.string(),
          vitePort: z.number(),
          headless: z.boolean(),
          startedAt: z.string(),
          connectedSessions: z.array(z.string()),
          viteAlive: z.boolean(),
        }),
      ),
    },
    annotations: { readOnlyHint: true },
    summarize: (o) => `${o.sessions.length} sessão(ões), ${o.launches.length} lançamento(s)${o.bridge ? ` — bridge ${o.bridge.url}` : " — bridge parado"}`,
    run: async ({ refresh }, ctx) => {
      const st = state(ctx);
      const bridge = st.bridge;
      const sessions = bridge?.list() ?? [];
      const quickTimeout = Math.min(3000, st.options.requestTimeoutMs);
      const infos = await Promise.all(
        sessions.map(async (s) => {
          let fps: number | null = null;
          let isPaused: boolean | null = null;
          if (refresh !== false) {
            await refreshKernelStatus(s, quickTimeout);
            try {
              const stats = await s.request<z.infer<typeof loopStatsSchema>>("loop.stats", undefined, { timeoutMs: quickTimeout });
              if (stats.available) {
                fps = stats.fps;
                isPaused = stats.isPaused;
              }
            } catch {
              /* sessão lenta: mantém null */
            }
          }
          return { ...s.info(), launched: s.launchId !== null && st.launches.has(s.launchId), fps, isPaused };
        }),
      );
      const listen = bridge?.listening ?? null;
      return {
        bridge: listen ? { url: listen.url, port: listen.port, requestedPort: listen.requestedPort, fallback: listen.fallback } : null,
        sessions: infos,
        launches: [...st.launches.values()].map((l) => ({
          launchId: l.info.launchId,
          project: l.info.project,
          url: l.info.url,
          vitePort: l.info.vitePort,
          headless: l.info.headless,
          startedAt: l.info.startedAt,
          connectedSessions: sessions.filter((s) => s.launchId === l.info.launchId).map((s) => s.sessionId),
          viteAlive: !l.viteExited,
        })),
      };
    },
  }),

  defineTool({
    name: "runtime_stop",
    title: "Parar uma sessão de jogo",
    description:
      "Fecha a sessão. Se ela foi aberta por runtime_launch, fecha o Chromium e mata o Vite (grupo de processos). " +
      "Aceita o sessionId atual ou o devolvido por runtime_launch (mesmo após reconexão).",
    input: { sessionId: z.string().min(1).max(128).describe("id da sessão (runtime_status) ou launchId") },
    output: {
      sessionId: z.string(),
      launched: z.boolean(),
      closedSessions: z.array(z.string()),
      closedBrowser: z.boolean(),
      killedVite: z.boolean(),
    },
    annotations: { destructiveHint: true },
    summarize: (o) => `parado: ${o.sessionId}${o.launched ? " (navegador e vite encerrados)" : ""}`,
    run: async ({ sessionId }, ctx) => {
      const st = state(ctx);
      const bridge = st.bridge;
      const session = bridge?.get(sessionId) ?? null;
      let launch: LaunchedRuntime | undefined;
      if (session?.launchId) launch = st.launches.get(session.launchId);
      launch ??= st.launches.get(sessionId) ?? [...st.launches.values()].find((l) => l.info.sessionId === sessionId);
      if (!session && !launch) {
        throw new McpToolError("NO_RUNTIME", `sessão ${sessionId} não existe`, "runtime_status lista as sessões e lançamentos.", {
          sessions: bridge?.list().map((s) => s.sessionId) ?? [],
        });
      }
      const closedSessions: string[] = [];
      let closedBrowser = false;
      let killedVite = false;
      if (launch) {
        const launchSessions = bridge?.list().filter((s) => s.launchId === launch.info.launchId).map((s) => s.sessionId) ?? [];
        const r = await launch.stop();
        closedBrowser = r.closedBrowser;
        killedVite = r.killedVite;
        closedSessions.push(...launchSessions);
        st.launches.delete(launch.info.launchId);
      }
      if (session && bridge?.closeSession(session.sessionId, "runtime_stop") && !closedSessions.includes(session.sessionId)) {
        closedSessions.push(session.sessionId);
      }
      return { sessionId, launched: launch !== undefined, closedSessions, closedBrowser, killedVite };
    },
  }),
];

async function refreshKernelStatus(session: BridgeSession, timeoutMs: number): Promise<void> {
  try {
    const inspection = await session.request<{ status?: unknown }>("kernel.inspect", undefined, { timeoutMs });
    if (typeof inspection?.status === "string") {
      session.lastKernelStatus = inspection.status;
      session.lastKernelStatusAtMs = Date.now();
    }
  } catch {
    /* ignora: status fica o anterior */
  }
}

/* ============================================================================
 * Tools de inspeção/controle do jogo
 * ========================================================================== */

/** Tool fina: valida, escolhe sessão, chama o método e devolve o resultado. */
function gameTool<S extends z.ZodRawShape>(spec: {
  name: string;
  title: string;
  description: string;
  method: DevBridgeMethod;
  input: S;
  params?: (args: z.output<z.ZodObject<S>>) => unknown;
  wrap?: (result: unknown) => Record<string, unknown>;
  readOnly?: boolean;
  summarize?: (result: Record<string, unknown>) => string;
}): ToolDef {
  return defineTool({
    name: spec.name,
    title: spec.title,
    description: spec.description,
    input: { sessionId: sessionIdInput, ...spec.input },
    ...(spec.readOnly ? { annotations: { readOnlyHint: true } } : {}),
    run: async (args, ctx, call) => {
      const { sessionId, ...rest } = args as { sessionId?: string } & Record<string, unknown>;
      const session = resolveSession(ctx, sessionId);
      const params = spec.params ? spec.params(rest as z.output<z.ZodObject<S>>) : Object.keys(rest).length ? compact(rest) : undefined;
      const result = await callGame(session, spec.method, params, call);
      const data = spec.wrap ? spec.wrap(result) : ((result ?? {}) as Record<string, unknown>);
      const out = { sessionId: session.sessionId, ...data };
      return toolResult({ data: out, summary: spec.summarize ? spec.summarize(out) : `${spec.name}: ok (${session.sessionId})` });
    },
  });
}

const gameTools: ToolDef[] = [
  defineTool({
    name: "kernel_inspect",
    title: "Kernel do jogo",
    description: "kernel.inspect() do jogo rodando: status (running…), apiVersion, plugins (estado, provides/consumes), capabilities, slots e bootOrder.",
    input: { sessionId: sessionIdInput },
    annotations: { readOnlyHint: true },
    run: async ({ sessionId }, ctx, call) => {
      const session = resolveSession(ctx, sessionId);
      const inspection = await callGame<Record<string, unknown>>(session, "kernel.inspect", undefined, call);
      if (typeof inspection?.status === "string") {
        session.lastKernelStatus = inspection.status;
        session.lastKernelStatusAtMs = Date.now();
      }
      const plugins = Array.isArray(inspection?.plugins) ? inspection.plugins.length : 0;
      return toolResult({
        data: { sessionId: session.sessionId, ...inspection },
        summary: `kernel ${String(inspection?.status)} — ${plugins} plugin(s) (${session.sessionId})`,
      });
    },
  }),

  defineTool({
    name: "loop_control",
    title: "Pausar / continuar / avançar o game loop",
    description:
      "Controla o game loop: pause, resume, step (avança `ticks` ticks fixos; exige o loop pausado) ou stats. Devolve getStats() do loop.",
    input: {
      sessionId: sessionIdInput,
      action: z.enum(["pause", "resume", "step", "stats"]).describe("pause | resume | step (com loop pausado) | stats"),
      ticks: z.number().int().min(1).max(DEVBRIDGE_MAX_STEP_TICKS).optional().describe(`só para step: 1..${DEVBRIDGE_MAX_STEP_TICKS} (padrão 1)`),
      freezeRender: z.boolean().optional().describe("só para pause: congela também o render"),
    },
    output: { sessionId: z.string(), action: z.string(), ticksRun: z.number().optional(), stats: loopStatsSchema },
    summarize: (o) => `loop ${o.stats.isPaused ? "pausado" : "rodando"}${o.ticksRun !== undefined ? `, ${o.ticksRun} tick(s)` : ""} (fps ${o.stats.fps})`,
    run: async ({ sessionId, action, ticks, freezeRender }, ctx, call) => {
      if (ticks !== undefined && action !== "step") throw new McpToolError("INVALID_INPUT", "ticks só vale para action=step");
      if (freezeRender !== undefined && action !== "pause") throw new McpToolError("INVALID_INPUT", "freezeRender só vale para action=pause");
      const session = resolveSession(ctx, sessionId);
      type Stats = z.infer<typeof loopStatsSchema>;
      if (action === "step") {
        const r = await callGame<{ ticksRun: number; stats: Stats }>(session, "loop.step", { ticks: ticks ?? 1 }, call);
        return { sessionId: session.sessionId, action, ticksRun: r.ticksRun, stats: r.stats };
      }
      const method: DevBridgeMethod = action === "pause" ? "loop.pause" : action === "resume" ? "loop.resume" : "loop.stats";
      const params = action === "pause" && freezeRender !== undefined ? { freezeRender } : undefined;
      const stats = await callGame<Stats>(session, method, params, call);
      return { sessionId: session.sessionId, action, stats };
    },
  }),

  defineTool({
    name: "world_entities",
    title: "Entidades do world",
    description: "Lista snapshots de entidades do world (filtros: type, tag, near {x,y,z,r} por distância; limit até 1000).",
    input: {
      sessionId: sessionIdInput,
      type: z.string().min(1).max(128).optional().describe("filtra pelo type da entidade"),
      tag: z.string().min(1).max(128).optional().describe("filtra por tag"),
      near: z.object({ x: num, y: num, z: num, r: z.number().positive() }).strict().optional().describe("esfera de busca; resultados trazem distance"),
      limit: z.number().int().min(1).max(DEVBRIDGE_MAX_LIST_LIMIT).optional().describe("padrão 100"),
    },
    output: { sessionId: z.string(), total: z.number(), returned: z.number(), entities: z.array(entitySnapshotSchema) },
    annotations: { readOnlyHint: true },
    summarize: (o) => `${o.returned} de ${o.total} entidade(s)`,
    run: async ({ sessionId, ...filters }, ctx, call) => {
      const session = resolveSession(ctx, sessionId);
      const r = await callGame<{ total: number; returned: number; entities: z.infer<typeof entitySnapshotSchema>[] }>(
        session,
        "world.list",
        compact(filters),
        call,
      );
      return { sessionId: session.sessionId, ...r };
    },
  }),

  gameTool({
    name: "world_entity",
    title: "Uma entidade do world",
    description: "Snapshot completo de uma entidade (posição, rotação, escala, tags, customData).",
    method: "world.get",
    input: { entityId: entityIdInput },
    readOnly: true,
    summarize: (o) => `entidade ${String(o.entityId)} (${String(o.type)})`,
  }),

  gameTool({
    name: "world_spawn",
    title: "Criar entidade no jogo",
    description: "Spawna (ou substitui) uma entidade no world do jogo rodando. Campos ausentes usam os padrões do world.",
    method: "world.spawn",
    input: {
      entityId: entityIdInput,
      type: z.string().min(1).max(128).optional().describe("type da entidade (padrão do world)"),
      position: partialVec3.optional().describe("{x?,y?,z?} (padrão 0)"),
      rotation: quat.optional(),
      scale: partialVec3.optional().describe("{x?,y?,z?} (padrão 1)"),
      tags: tags.optional(),
      customData: customData.optional(),
    },
    summarize: (o) => `entidade spawnada${o.replaced ? " (substituiu existente)" : ""}`,
  }),

  gameTool({
    name: "world_despawn",
    title: "Remover entidade do jogo",
    description: "Remove uma entidade do world (NOT_FOUND se não existir).",
    method: "world.despawn",
    input: { entityId: entityIdInput },
    summarize: (o) => (o.despawned ? "entidade removida" : "world recusou remover"),
  }),

  gameTool({
    name: "world_patch",
    title: "Alterar entidade do jogo",
    description: "Aplica um patch parcial (type, position, rotation, scale, tags, customData) numa entidade existente.",
    method: "world.patch",
    input: {
      entityId: entityIdInput,
      patch: z
        .object({
          type: z.string().min(1).max(128).optional(),
          position: vec3.optional(),
          rotation: quat.optional(),
          scale: vec3.optional(),
          tags: tags.optional(),
          customData: customData.optional(),
        })
        .strict()
        .describe("campos a mudar (vetores completos)"),
    },
    params: (a) => ({ entityId: a.entityId, patch: compact(a.patch as Record<string, unknown>) }),
    summarize: () => "entidade alterada",
  }),

  gameTool({
    name: "world_snapshot",
    title: "Estado completo do world",
    description: "serializeWorldState() do jogo (sceneId, entityCount e o estado completo). Pode ser grande.",
    method: "world.snapshot",
    input: {},
    readOnly: true,
    summarize: (o) => `world: cena ${String(o.sceneId)}, ${String(o.entityCount)} entidade(s)`,
  }),

  gameTool({
    name: "physics_raycast",
    title: "Raycast na física",
    description: "Lança um raio na física do jogo e devolve o hit (ou null).",
    method: "physics.raycast",
    input: {
      origin: vec3.describe("origem do raio"),
      direction: vec3.describe("direção (não precisa ser normalizada)"),
      maxDistance: z.number().positive().max(1e6).describe("distância máxima"),
      excludeEntityId: entityIdInput.optional().describe("entidade a ignorar"),
    },
    wrap: (hit) => ({ hit: hit ?? null }),
    readOnly: true,
    summarize: (o) => (o.hit && (o.hit as { hit?: boolean }).hit !== false ? "raio acertou" : "nenhum hit"),
  }),

  gameTool({
    name: "physics_stats",
    title: "Estatísticas da física",
    description: "getStats() da física (corpos, colliders, tempo de step, wasm carregado).",
    method: "physics.stats",
    input: {},
    readOnly: true,
  }),

  gameTool({
    name: "camera_get",
    title: "Câmera atual",
    description: "Câmera ativa, alvo seguido e snapshot (posição, rotação, fov).",
    method: "camera.get",
    input: {},
    readOnly: true,
    summarize: (o) => `câmera ${String(o.activeCameraId)}`,
  }),

  gameTool({
    name: "camera_set",
    title: "Trocar/seguir com a câmera",
    description: "Troca a câmera ativa (cameraId) e/ou faz a câmera seguir uma entidade (followTargetId; null para parar).",
    method: "camera.set",
    input: {
      cameraId: z.string().min(1).max(128).optional().describe("id de câmera registrada"),
      followTargetId: z.string().min(1).max(128).nullable().optional().describe("id de entidade a seguir; null para parar"),
    },
    params: (a) => {
      if (a.cameraId === undefined && a.followTargetId === undefined) {
        throw new McpToolError("INVALID_INPUT", "informe cameraId e/ou followTargetId");
      }
      return compact(a as Record<string, unknown>);
    },
    summarize: (o) => `câmera ${String(o.activeCameraId)}${o.followTargetId ? ` seguindo ${String(o.followTargetId)}` : ""}`,
  }),

  gameTool({
    name: "input_send",
    title: "Enviar input sintético",
    description:
      "Dispara eventos DOM sintéticos no jogo: teclas (KeyboardEvent code, ex. KeyW, Space; down true/false), ponteiro " +
      "(x,y em px CSS relativos ao canvas; buttons bitmask 1 esq/2 dir/4 meio) e roda do mouse.",
    method: "input.send",
    input: {
      keys: z
        .array(z.object({ code: z.string().min(1).max(32), down: z.boolean(), key: z.string().min(1).max(32).optional() }).strict())
        .max(64)
        .optional()
        .describe("sequência de teclas, ex.: [{code:'KeyW',down:true},{code:'KeyW',down:false}]"),
      pointer: z.object({ x: num, y: num, buttons: z.number().int().min(0).max(31).optional() }).strict().optional(),
      wheel: z.object({ deltaX: num.optional(), deltaY: num }).strict().optional(),
    },
    params: (a) => {
      if (a.keys === undefined && a.pointer === undefined && a.wheel === undefined) {
        throw new McpToolError("INVALID_INPUT", "informe keys, pointer e/ou wheel");
      }
      return compact(a as Record<string, unknown>);
    },
    summarize: (o) => `${String(o.dispatched)} evento(s) disparado(s)`,
  }),

  gameTool({
    name: "events_subscribe",
    title: "Escolher eventos capturados",
    description:
      "Define os globs de eventos do kernel guardados no buffer do jogo (ex.: ['game.world.*']; '*' = todos, exceto tick/render). " +
      "Leia com events_tail.",
    method: "events.subscribe",
    input: {
      patterns: z
        .array(z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:*?-]+$/, "use letras, números, . _ - : * ?"))
        .min(1)
        .max(32)
        .describe("globs; * casa qualquer sequência (inclusive pontos)"),
    },
    summarize: (o) => `capturando: ${(o.patterns as string[]).join(", ")}`,
  }),

  gameTool({
    name: "events_tail",
    title: "Eventos capturados",
    description: "Eventos do kernel capturados (payload truncado em 8 KiB). Use since=lastSeq para ler só os novos.",
    method: "events.tail",
    input: { since: tailSince, limit: tailLimit },
    readOnly: true,
    summarize: (o) => `${(o.events as unknown[]).length} evento(s), lastSeq ${String(o.lastSeq)}`,
  }),

  gameTool({
    name: "commands_send",
    title: "Enviar command game.*",
    description: "Envia um command registrado do jogo (só tipos game.*) via commands.request e devolve a resposta.",
    method: "commands.send",
    input: {
      command: z.string().regex(/^game\.[A-Za-z0-9_.-]+$/, "só comandos game.*").max(128).describe("tipo do command, ex.: game.world.reset"),
      payload: z.unknown().optional().describe("payload JSON do command"),
    },
    summarize: (o) => `command ${String(o.command)} ok`,
  }),

  gameTool({
    name: "logs_tail",
    title: "Console do jogo",
    description: "Console capturado do jogo (console.*, window.onerror, unhandledrejection). Filtro por nível mínimo; since=lastSeq para os novos.",
    method: "logs.tail",
    input: {
      level: z.enum(["debug", "log", "info", "warn", "error"]).optional().describe("nível mínimo (debug < log/info < warn < error)"),
      since: tailSince,
      limit: tailLimit,
    },
    readOnly: true,
    summarize: (o) => `${(o.logs as unknown[]).length} linha(s) de log, lastSeq ${String(o.lastSeq)}`,
  }),

  defineTool({
    name: "screenshot",
    title: "Screenshot do jogo",
    description: "Renderiza um frame e devolve o canvas do jogo como imagem PNG (conteúdo MCP image) + {width,height,bytes}.",
    input: {
      sessionId: sessionIdInput,
      maxWidth: z.number().int().min(1).max(DEVBRIDGE_MAX_SCREENSHOT_WIDTH).optional().describe("largura máxima em px (padrão 1280; mantém proporção)"),
    },
    output: { sessionId: z.string(), mimeType: z.string(), width: z.number(), height: z.number(), bytes: z.number() },
    annotations: { readOnlyHint: true },
    run: async ({ sessionId, maxWidth }, ctx, call) => {
      const st = state(ctx);
      const session = resolveSession(ctx, sessionId);
      const shot = await callGame<ScreenshotResult>(
        session,
        "screenshot",
        maxWidth === undefined ? undefined : { maxWidth },
        call,
        st.options.screenshotTimeoutMs,
      );
      if (typeof shot?.data !== "string" || shot.data.length === 0) {
        throw new McpToolError("BRIDGE_ERROR", "screenshot sem dados", undefined, { code: "METHOD_FAILED", method: "screenshot" });
      }
      const bytes = Buffer.byteLength(shot.data, "base64");
      return toolResult({
        data: { sessionId: session.sessionId, mimeType: shot.mimeType, width: shot.width, height: shot.height, bytes },
        summary: `screenshot ${shot.width}x${shot.height} (${bytes} bytes)`,
        images: [{ data: shot.data, mimeType: shot.mimeType || "image/png" }],
      });
    },
  }),

  gameTool({
    name: "perf_stats",
    title: "Desempenho do jogo",
    description: "fps, frame time, draw calls, triângulos, geometrias/texturas, memória JS (se houver), entidades e stats de física.",
    method: "perf.stats",
    input: {},
    readOnly: true,
    summarize: (o) => `fps ${String(o.fps)}, draw calls ${String(o.drawCalls)}`,
  }),

  gameTool({
    name: "storage_slots",
    title: "Saves do jogo",
    description: "listSaves() do storage do jogo (slots de save).",
    method: "storage.slots",
    input: {},
    readOnly: true,
    summarize: (o) => `${Array.isArray(o.slots) ? o.slots.length : 0} save(s)`,
  }),
];

/* ============================================================================
 * scene_load_live
 * ========================================================================== */

const SCENE_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;

function formatSceneErrors(errors: ReadonlyArray<SceneDocumentError>): string {
  return errors
    .slice(0, 5)
    .map((e) => `${e.path || "(raiz)"}: ${e.code} ${e.message}`)
    .join("; ");
}

async function readJson(ctx: ToolContext, rel: string): Promise<unknown> {
  const text = await readFile(ctx.paths.resolve(rel), "utf8");
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new McpToolError("SCHEMA_INVALID", `${rel}: JSON inválido (${error instanceof Error ? error.message : String(error)})`);
  }
}

/** Lê e valida todos os `*.prefab.json` de `src/projects/<id>/prefabs`. */
export async function loadProjectPrefabs(ctx: ToolContext, id: string): Promise<Record<string, PrefabDocument>> {
  const dirRel = `src/projects/${id}/prefabs`;
  const dirAbs = ctx.paths.resolve(dirRel);
  const prefabs: Record<string, PrefabDocument> = {};
  if (!existsSync(dirAbs)) return prefabs;
  const files = (await readdir(dirAbs)).filter((f) => f.endsWith(".prefab.json")).sort();
  for (const file of files) {
    const rel = `${dirRel}/${file}`;
    const check = validatePrefabDocument(await readJson(ctx, rel));
    if (!check.ok) {
      throw new McpToolError("SCHEMA_INVALID", `prefab ${rel} inválido: ${formatSceneErrors(check.errors)}`, "Corrija o prefab (scene_validate / prefab_read).", {
        file: rel,
        errors: check.errors.slice(0, 50),
      });
    }
    if (prefabs[check.value.prefabId]) {
      throw new McpToolError("SCHEMA_INVALID", `prefabId repetido: ${check.value.prefabId} (${rel})`, undefined, { file: rel });
    }
    prefabs[check.value.prefabId] = check.value;
  }
  return prefabs;
}

const sceneLoadLive = defineTool({
  name: "scene_load_live",
  title: "Carregar cena no jogo rodando",
  description:
    "Valida (validateSceneDocument) e carrega um SceneDocument no jogo rodando via world.loadSceneDocument. " +
    "`scene` = nome do arquivo em src/projects/<id>/scenes (ex.: fase-1 ou fase-1.scene.json) ou o documento inline. " +
    "Prefabs de src/projects/<id>/prefabs/*.prefab.json são carregados automaticamente.",
  input: {
    sessionId: sessionIdInput,
    id: idInput,
    scene: z
      .union([z.string().min(1).max(160), z.record(z.string(), z.unknown())])
      .describe("nome do arquivo de cena (sem pastas) ou um SceneDocument v1 inline {format:'engine.scene',version:1,...}"),
  },
  output: {
    sessionId: z.string(),
    source: z.string(),
    loaded: z.boolean(),
    sceneId: z.string().nullable(),
    entityCount: z.number().nullable(),
    prefabsLoaded: z.number(),
    projectMismatch: z.boolean(),
  },
  summarize: (o) => `cena ${String(o.sceneId)} carregada (${String(o.entityCount)} entidade(s))`,
  run: async ({ sessionId, id, scene }, ctx, call) => {
    const st = state(ctx);
    const projectRel = `src/projects/${id}`;
    if (!existsSync(ctx.paths.resolve(projectRel))) {
      throw new McpToolError("NOT_FOUND", `jogo ${id} não existe em ${projectRel}`, "Use project_list.");
    }
    let document: unknown;
    let source: string;
    if (typeof scene === "string") {
      if (!SCENE_NAME_RE.test(scene) || scene.includes("..")) {
        throw new McpToolError("INVALID_INPUT", `nome de cena inválido: ${scene}`, "Só o nome do arquivo (sem pastas), ex.: fase-1 ou fase-1.scene.json.");
      }
      const file = scene.endsWith(".json") ? scene : `${scene}.scene.json`;
      source = `${projectRel}/scenes/${file}`;
      if (!existsSync(ctx.paths.resolve(source))) {
        throw new McpToolError("NOT_FOUND", `cena não encontrada: ${source}`, "Use scene_list para ver as cenas do jogo.");
      }
      document = await readJson(ctx, source);
    } else {
      document = scene;
      source = "inline";
    }
    const prefabs = await loadProjectPrefabs(ctx, id);
    const check = validateSceneDocument(document, { prefabs });
    if (!check.ok) {
      throw new McpToolError("SCHEMA_INVALID", `cena inválida (${source}): ${formatSceneErrors(check.errors)}`, "Corrija o documento; scene_validate mostra todos os erros.", {
        errors: check.errors.slice(0, 50),
      });
    }
    const session = resolveSession(ctx, sessionId, id);
    const prefabCount = Object.keys(prefabs).length;
    const result = await callGame<{ loaded: boolean; sceneId: string | null; entityCount: number | null; error: unknown }>(
      session,
      "scene.load",
      prefabCount > 0 ? { document, prefabs } : { document },
      call,
      Math.max(st.options.requestTimeoutMs, 4 * st.options.requestTimeoutMs),
    );
    if (!result.loaded) {
      throw new McpToolError("BRIDGE_ERROR", `o jogo recusou a cena (${source})`, "Veja details.error e logs_tail.", {
        code: "SCENE_LOAD_FAILED",
        method: "scene.load",
        sessionId: session.sessionId,
        error: result.error ?? null,
      });
    }
    return {
      sessionId: session.sessionId,
      source,
      loaded: true,
      sceneId: result.sceneId ?? null,
      entityCount: result.entityCount ?? null,
      prefabsLoaded: prefabCount,
      projectMismatch: session.project !== null && session.project !== id,
    };
  },
});

export const tools: ToolDef[] = [...lifecycleTools, ...gameTools, sceneLoadLive];
