/**
 * Protocolo DevBridge v1 (jogo em DEV ↔ servidor MCP em tools/mcp).
 *
 * ESTE ARQUIVO É COMPARTILHADO: o servidor MCP (Node) o importa via
 * `tools/mcp/src/runtime/protocol.ts`. Por isso ele é TypeScript puro — sem
 * imports, sem DOM, sem engine. Só tipos, constantes e validadores.
 *
 * Fluxo (JSON por WebSocket, o jogo é o CLIENTE):
 *   jogo → servidor  {type:"hello", protocol:1, token, project, kernelApiVersion, userAgent}
 *   servidor → jogo  {type:"welcome", protocol:1} | {type:"reject", reason}
 *   servidor → jogo  {type:"req", id, method, params}
 *   jogo → servidor  {type:"res", id, ok:true, result} | {type:"res", id, ok:false, error:{code,message}}
 *   qualquer lado    {type:"ping", ts} → {type:"pong", ts}
 *
 * Modelo PULL: logs e eventos ficam em buffers circulares no jogo e são lidos
 * com `logs.tail` / `events.tail` (sem push).
 */

export const DEVBRIDGE_PROTOCOL_VERSION = 1 as const;

/** Tamanho máximo de uma mensagem serializada (resposta inclusa). */
export const DEVBRIDGE_MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
/** Tamanho máximo do JSON de um `result` que não seja screenshot. */
export const DEVBRIDGE_MAX_RESULT_BYTES = 1024 * 1024;
/** Payload de evento capturado é truncado neste tamanho (JSON). */
export const DEVBRIDGE_MAX_EVENT_PAYLOAD_BYTES = 8 * 1024;
/** Mensagem de log capturada é truncada neste tamanho. */
export const DEVBRIDGE_MAX_LOG_MESSAGE_BYTES = 4 * 1024;
export const DEVBRIDGE_LOG_BUFFER_SIZE = 1000;
export const DEVBRIDGE_EVENT_BUFFER_SIZE = 2000;
export const DEVBRIDGE_DEFAULT_TAIL_LIMIT = 100;
export const DEVBRIDGE_MAX_TAIL_LIMIT = 1000;
export const DEVBRIDGE_MAX_LIST_LIMIT = 1000;
export const DEVBRIDGE_MAX_STEP_TICKS = 600;
export const DEVBRIDGE_DEFAULT_SCREENSHOT_WIDTH = 1280;
export const DEVBRIDGE_MAX_SCREENSHOT_WIDTH = 4096;
/** Intervalo de ping do cliente (ms) e tempo sem resposta que derruba a conexão. */
export const DEVBRIDGE_HEARTBEAT_MS = 10_000;
export const DEVBRIDGE_HEARTBEAT_TIMEOUT_MS = 30_000;
/** Backoff de reconexão: começa em MIN, dobra, para em MAX. */
export const DEVBRIDGE_RECONNECT_MIN_MS = 250;
export const DEVBRIDGE_RECONNECT_MAX_MS = 10_000;
/** Padrões iniciais de captura de eventos (tick/render só se citados exatamente). */
export const DEVBRIDGE_DEFAULT_EVENT_PATTERNS: readonly string[] = ["*"];
/** Eventos de alta frequência ignorados por curingas (precisam ser citados exatamente). */
export const DEVBRIDGE_NOISY_EVENTS: readonly string[] = ["game.loop.tick", "game.loop.render"];

// ── Métodos (tabela fechada) ─────────────────────────────────────────────

export const DEVBRIDGE_METHODS = [
  "kernel.inspect",
  "loop.stats",
  "loop.pause",
  "loop.resume",
  "loop.step",
  "world.list",
  "world.get",
  "world.spawn",
  "world.despawn",
  "world.patch",
  "world.snapshot",
  "physics.raycast",
  "physics.stats",
  "camera.get",
  "camera.set",
  "input.send",
  "events.subscribe",
  "events.tail",
  "commands.send",
  "logs.tail",
  "screenshot",
  "perf.stats",
  "storage.slots",
  "scene.load",
] as const;

export type DevBridgeMethod = (typeof DEVBRIDGE_METHODS)[number];

export function isDevBridgeMethod(value: unknown): value is DevBridgeMethod {
  return typeof value === "string" && (DEVBRIDGE_METHODS as readonly string[]).includes(value);
}

export type DevBridgeErrorCode =
  | "INVALID_PARAMS"
  | "UNKNOWN_METHOD"
  | "NOT_AVAILABLE"
  | "NOT_FOUND"
  | "COMMAND_NOT_ALLOWED"
  | "RESULT_TOO_LARGE"
  | "METHOD_FAILED"
  | "BAD_MESSAGE";

export interface DevBridgeError {
  readonly code: DevBridgeErrorCode;
  readonly message: string;
}

// ── Tipos de parâmetros/resultados (contrato com tools/mcp) ──────────────

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Quat {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export interface LoopStatsResult {
  readonly available: boolean;
  readonly fps: number;
  readonly targetFps: number;
  readonly tickRate: number;
  readonly isPaused: boolean;
  readonly isHidden: boolean;
  readonly runningTimeSeconds: number;
}

export interface LoopStepParams {
  /** Inteiro 1..600 (padrão 1). */
  readonly ticks?: number;
}

export interface LoopStepResult {
  readonly ticksRun: number;
  readonly stats: LoopStatsResult;
}

export interface WorldListParams {
  readonly type?: string;
  readonly tag?: string;
  readonly near?: { readonly x: number; readonly y: number; readonly z: number; readonly r: number };
  /** 1..1000 (padrão 100). */
  readonly limit?: number;
}

export interface EntitySnapshot {
  readonly entityId: string;
  readonly type: string;
  readonly position: Vec3;
  readonly rotation: Quat;
  readonly scale: Vec3;
  readonly tags: readonly string[];
  readonly customData: unknown;
  /** Só em `world.list` com `near`. */
  readonly distance?: number;
}

export interface WorldListResult {
  readonly total: number;
  readonly returned: number;
  readonly entities: readonly EntitySnapshot[];
}

export interface WorldSpawnParams {
  readonly entityId: string;
  readonly type?: string;
  readonly position?: Partial<Vec3>;
  readonly rotation?: Quat;
  readonly scale?: Partial<Vec3>;
  readonly tags?: readonly string[];
  readonly customData?: Record<string, unknown>;
}

export interface WorldPatchParams {
  readonly entityId: string;
  readonly patch: {
    readonly type?: string;
    readonly position?: Vec3;
    readonly rotation?: Quat;
    readonly scale?: Vec3;
    readonly tags?: readonly string[];
    readonly customData?: Record<string, unknown>;
  };
}

export interface PhysicsRaycastParams {
  readonly origin: Vec3;
  readonly direction: Vec3;
  readonly maxDistance: number;
  readonly excludeEntityId?: string;
}

export interface CameraSetParams {
  readonly cameraId?: string;
  /** Id de entidade do world seguida a cada frame pela câmera ativa; null para parar. */
  readonly followTargetId?: string | null;
}

export interface CameraGetResult {
  readonly available: boolean;
  readonly activeCameraId: string | null;
  readonly followTargetId: string | null;
  readonly snapshot: {
    readonly position: Vec3;
    readonly rotation: Quat;
    readonly fov: number;
  } | null;
}

export interface InputSendParams {
  readonly keys?: readonly { readonly code: string; readonly down: boolean; readonly key?: string }[];
  /** Coordenadas em CSS px relativas ao canvas; `buttons` = bitmask do DOM (1 esq., 2 dir., 4 meio). */
  readonly pointer?: { readonly x: number; readonly y: number; readonly buttons?: number };
  readonly wheel?: { readonly deltaX?: number; readonly deltaY: number };
}

export interface InputSendResult {
  readonly dispatched: number;
}

export interface EventsSubscribeParams {
  /** Globs: `*` casa qualquer sequência (inclusive pontos). Ex.: `game.world.*`. */
  readonly patterns: readonly string[];
}

export interface TailParams {
  /** Devolve só entradas com `seq > since`. */
  readonly since?: number;
  /** 1..1000 (padrão 100); as MAIS RECENTES. */
  readonly limit?: number;
}

export interface CapturedEvent {
  readonly seq: number;
  readonly ts: number;
  readonly type: string;
  readonly source: string;
  readonly payload: unknown;
  readonly truncated: boolean;
}

export interface EventsTailResult {
  readonly patterns: readonly string[];
  readonly lastSeq: number;
  readonly dropped: number;
  readonly events: readonly CapturedEvent[];
}

export type CapturedLogLevel = "debug" | "log" | "info" | "warn" | "error";

export interface LogsTailParams extends TailParams {
  /** Nível mínimo (debug < log/info < warn < error). */
  readonly level?: CapturedLogLevel;
}

export interface CapturedLog {
  readonly seq: number;
  readonly ts: number;
  readonly level: CapturedLogLevel;
  readonly message: string;
  /** "console" | "window.error" | "unhandledrejection". */
  readonly origin: string;
}

export interface LogsTailResult {
  readonly lastSeq: number;
  readonly dropped: number;
  readonly logs: readonly CapturedLog[];
}

export interface CommandsSendParams {
  /** Só `game.*`. */
  readonly command: string;
  readonly payload?: unknown;
  /**
   * Obrigatório (true) para comandos com efeito externo
   * (`isSideEffectDevBridgeCommand`); o jogo ainda exige o próprio opt-in.
   */
  readonly allowSideEffects?: boolean;
}

// ── commands.send: forma e comandos com efeito externo ───────────────────

/** Forma aceita em `commands.send` (só `game.*`). */
export const DEVBRIDGE_COMMAND_RE = /^game\.[A-Za-z0-9_.-]+$/;

/**
 * Prefixos (minúsculos) de comandos com efeito FORA do jogo — dinheiro real,
 * Steamworks, rede, Steam Workshop, perfil online e janela nativa. Recusados
 * por padrão nos DOIS lados (MCP e jogo); liberar exige
 * `ENGINE_MCP_ALLOW_SIDE_EFFECT_COMMANDS=1` no MCP (que manda
 * `allowSideEffects: true`) E `devbridgeUnsafe=1` / `VITE_DEVBRIDGE_UNSAFE=1`
 * no jogo. Lista única: o MCP importa este arquivo.
 *
 * Fonte: commands declarados em src/plugins/*\/plugin.ts. Comandos locais
 * (world, physics, camera, ui, storage save/load, modding enable/disable,
 * security…) continuam livres.
 */
export const DEVBRIDGE_SIDE_EFFECT_COMMAND_PREFIXES: readonly string[] = [
  "game.monetization.", // init/finalize-purchase, consume-item, fetch-inventory (Steam Inventory/MicroTxn)
  "game.steam.", // conquistas, lobbies, sessões/pacotes P2P
  "game.net.", // connect, disconnect, send, broadcast-snapshot
  "game.modding.publish-", // publish-workshop
  "game.modding.download-", // download-workshop
  "game.modding.subscribe", // reservado (inscrição no Workshop)
  "game.storage.sync-", // sync-profile (backend online)
  "game.overlay.", // set-passthrough, set-always-on-top, dock-to-taskbar (janela nativa)
];

/** true se o comando tem efeito externo (ver `DEVBRIDGE_SIDE_EFFECT_COMMAND_PREFIXES`). */
export function isSideEffectDevBridgeCommand(command: string): boolean {
  if (typeof command !== "string") return false;
  const lower = command.toLowerCase();
  return DEVBRIDGE_SIDE_EFFECT_COMMAND_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

export interface ScreenshotParams {
  /** Largura máxima em px (1..4096, padrão 1280); mantém a proporção. */
  readonly maxWidth?: number;
}

export interface ScreenshotResult {
  readonly mimeType: "image/png";
  /** PNG em base64 (sem prefixo data:). */
  readonly data: string;
  readonly width: number;
  readonly height: number;
}

export interface PerfStatsResult {
  readonly fps: number | null;
  readonly frameTimeMs: number | null;
  readonly tickRate: number | null;
  readonly drawCalls: number | null;
  readonly triangles: number | null;
  readonly geometries: number | null;
  readonly textures: number | null;
  readonly memory: { readonly usedJSHeapSize: number; readonly totalJSHeapSize: number; readonly jsHeapSizeLimit: number } | null;
  readonly entities: number | null;
  readonly physics: unknown;
}

export interface SceneLoadParams {
  /** SceneDocument v1 (validado pela engine). */
  readonly document: unknown;
  /** PrefabDocuments por id (ou array). */
  readonly prefabs?: unknown;
}

// ── Mensagens ────────────────────────────────────────────────────────────

export interface HelloMessage {
  readonly type: "hello";
  readonly protocol: number;
  readonly token: string;
  readonly project: string | null;
  readonly kernelApiVersion: string;
  readonly userAgent: string;
}

export interface WelcomeMessage {
  readonly type: "welcome";
  readonly protocol: number;
  readonly sessionId?: string;
}

export interface RejectMessage {
  readonly type: "reject";
  readonly reason: string;
}

export interface RequestMessage {
  readonly type: "req";
  readonly id: string | number;
  readonly method: string;
  readonly params?: unknown;
}

export type ResponseMessage =
  | { readonly type: "res"; readonly id: string | number; readonly ok: true; readonly result: unknown }
  | { readonly type: "res"; readonly id: string | number; readonly ok: false; readonly error: DevBridgeError };

export interface PingMessage {
  readonly type: "ping";
  readonly ts: number;
}

export interface PongMessage {
  readonly type: "pong";
  readonly ts: number;
}

/** Reservado (push opcional); o cliente v1 não envia. */
export interface EventMessage {
  readonly type: "event";
  readonly kind: "log" | "engine-event" | "error";
  readonly data: unknown;
}

export type DevBridgeMessage =
  | HelloMessage
  | WelcomeMessage
  | RejectMessage
  | RequestMessage
  | ResponseMessage
  | PingMessage
  | PongMessage
  | EventMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string | number {
  return (typeof value === "string" && value.length > 0 && value.length <= 128) ||
    (typeof value === "number" && Number.isFinite(value));
}

/**
 * Valida a forma de uma mensagem recebida. Retorna null para JSON inválido,
 * tipo desconhecido ou campos obrigatórios ausentes.
 */
export function parseDevBridgeMessage(raw: string): DevBridgeMessage | null {
  if (typeof raw !== "string" || raw.length > DEVBRIDGE_MAX_MESSAGE_BYTES) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value) || typeof value.type !== "string") return null;
  switch (value.type) {
    case "hello":
      return typeof value.protocol === "number" && typeof value.token === "string" &&
          (typeof value.project === "string" || value.project === null) &&
          typeof value.kernelApiVersion === "string" && typeof value.userAgent === "string"
        ? (value as unknown as HelloMessage)
        : null;
    case "welcome":
      return typeof value.protocol === "number" ? (value as unknown as WelcomeMessage) : null;
    case "reject":
      return typeof value.reason === "string" ? (value as unknown as RejectMessage) : null;
    case "req":
      return isId(value.id) && typeof value.method === "string" ? (value as unknown as RequestMessage) : null;
    case "res":
      if (!isId(value.id) || typeof value.ok !== "boolean") return null;
      if (value.ok) return "result" in value ? (value as unknown as ResponseMessage) : null;
      return isRecord(value.error) && typeof value.error.code === "string" && typeof value.error.message === "string"
        ? (value as unknown as ResponseMessage)
        : null;
    case "ping":
    case "pong":
      return typeof value.ts === "number" ? (value as unknown as PingMessage | PongMessage) : null;
    case "event":
      return typeof value.kind === "string" ? (value as unknown as EventMessage) : null;
    default:
      return null;
  }
}

/** Hosts aceitos para o servidor MCP: só loopback. */
export const DEVBRIDGE_ALLOWED_HOSTS: readonly string[] = ["127.0.0.1", "localhost", "[::1]"];

/**
 * true só para `ws://` em loopback (127.0.0.1, localhost, [::1]) com porta
 * explícita ou padrão, sem credenciais. Nunca `wss:`/`http:`/hosts remotos.
 */
export function isLoopbackDevBridgeUrl(url: string): boolean {
  if (typeof url !== "string" || url.length === 0 || url.length > 512) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "ws:") return false;
  if (parsed.username !== "" || parsed.password !== "") return false;
  return DEVBRIDGE_ALLOWED_HOSTS.includes(parsed.hostname.toLowerCase());
}

/** Token aceito: 16..256 caracteres seguros para URL. */
export function isValidDevBridgeToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_\-.~]{16,256}$/.test(token);
}

/** Comparação de token em tempo constante (em relação ao conteúdo). */
export function devBridgeTokensEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/**
 * Converte um glob de tipo de evento em RegExp: `*` = qualquer sequência
 * (inclusive "."), `?` = um caractere; o resto é literal.
 */
export function devBridgeGlobToRegExp(pattern: string): RegExp {
  let source = "^";
  for (const ch of pattern) {
    if (ch === "*") source += ".*";
    else if (ch === "?") source += ".";
    else source += ch.replace(/[\\^$.|+()[\]{}]/g, "\\$&");
  }
  return new RegExp(`${source}$`);
}
