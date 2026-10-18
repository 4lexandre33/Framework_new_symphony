/**
 * Captura em anel para o DevBridge: console/erros não tratados e eventos do
 * kernel. Só existe em DEV (carregado por import() dinâmico no bootstrap).
 */
import {
  DEVBRIDGE_DEFAULT_EVENT_PATTERNS,
  DEVBRIDGE_DEFAULT_TAIL_LIMIT,
  DEVBRIDGE_EVENT_BUFFER_SIZE,
  DEVBRIDGE_LOG_BUFFER_SIZE,
  DEVBRIDGE_MAX_EVENT_PAYLOAD_BYTES,
  DEVBRIDGE_MAX_LOG_MESSAGE_BYTES,
  DEVBRIDGE_MAX_TAIL_LIMIT,
  DEVBRIDGE_NOISY_EVENTS,
  devBridgeGlobToRegExp,
  type CapturedEvent,
  type CapturedLog,
  type CapturedLogLevel,
} from "./protocol";

// ── JSON seguro ──────────────────────────────────────────────────────────

export interface JsonSafeOptions {
  readonly maxDepth?: number;
  readonly maxArrayItems?: number;
  readonly maxKeys?: number;
  readonly maxStringLength?: number;
}

/**
 * Converte qualquer valor em algo serializável: ciclos viram "[ciclo]",
 * funções "[função]", números não finitos viram string, Map/Set/TypedArray
 * resumidos, objetos de classe (THREE etc.) só com campos próprios
 * enumeráveis, profundidade/itens limitados.
 */
export function toJsonSafe(value: unknown, options: JsonSafeOptions = {}): unknown {
  const maxDepth = options.maxDepth ?? 8;
  const maxArrayItems = options.maxArrayItems ?? 200;
  const maxKeys = options.maxKeys ?? 100;
  const maxStringLength = options.maxStringLength ?? 4096;
  const seen = new WeakSet<object>();

  const walk = (input: unknown, depth: number): unknown => {
    switch (typeof input) {
      case "string":
        return input.length > maxStringLength ? `${input.slice(0, maxStringLength)}…` : input;
      case "number":
        return Number.isFinite(input) ? input : String(input);
      case "boolean":
        return input;
      case "bigint":
        return `${input.toString()}n`;
      case "undefined":
        return null;
      case "symbol":
        return input.toString();
      case "function":
        return "[função]";
      default:
        break;
    }
    if (input === null) return null;
    const obj = input as object;
    if (seen.has(obj)) return "[ciclo]";
    if (depth >= maxDepth) return "[…]";
    if (obj instanceof Error) {
      return { name: obj.name, message: obj.message, stack: typeof obj.stack === "string" ? walk(obj.stack, depth + 1) : null };
    }
    if (obj instanceof Date) return Number.isFinite(obj.getTime()) ? obj.toISOString() : "[data inválida]";
    if (ArrayBuffer.isView(obj)) return `[${obj.constructor.name}(${(obj as ArrayBufferView).byteLength} bytes)]`;
    if (obj instanceof ArrayBuffer) return `[ArrayBuffer(${obj.byteLength} bytes)]`;
    if (typeof Node !== "undefined" && obj instanceof Node) return `[${obj.nodeName}]`;
    seen.add(obj);
    try {
      if (obj instanceof Map) {
        const out: unknown[] = [];
        for (const [k, v] of obj) {
          if (out.length >= maxArrayItems) break;
          out.push([walk(k, depth + 1), walk(v, depth + 1)]);
        }
        return { "[Map]": out, size: obj.size };
      }
      if (obj instanceof Set) {
        const out: unknown[] = [];
        for (const v of obj) {
          if (out.length >= maxArrayItems) break;
          out.push(walk(v, depth + 1));
        }
        return { "[Set]": out, size: obj.size };
      }
      if (Array.isArray(obj)) {
        const out = obj.slice(0, maxArrayItems).map((v) => walk(v, depth + 1));
        if (obj.length > maxArrayItems) out.push(`[+${obj.length - maxArrayItems} itens]`);
        return out;
      }
      const out: Record<string, unknown> = {};
      let count = 0;
      for (const key of Object.keys(obj)) {
        if (count >= maxKeys) {
          out["…"] = `+${Object.keys(obj).length - maxKeys} chaves`;
          break;
        }
        let v: unknown;
        try {
          v = (obj as Record<string, unknown>)[key];
        } catch {
          v = "[getter lançou]";
        }
        out[key] = walk(v, depth + 1);
        count += 1;
      }
      return out;
    } finally {
      seen.delete(obj);
    }
  };

  return walk(value, 0);
}

/** JSON seguro limitado a `maxBytes` (aprox. em UTF-16). Truncado → string com prefixo. */
export function toBoundedJson(value: unknown, maxBytes: number): { value: unknown; truncated: boolean } {
  const safe = toJsonSafe(value);
  let text: string;
  try {
    text = JSON.stringify(safe) ?? "null";
  } catch {
    return { value: "[não serializável]", truncated: true };
  }
  if (text.length <= maxBytes) return { value: safe, truncated: false };
  return { value: `[truncado ${text.length} bytes] ${text.slice(0, Math.max(0, maxBytes - 32))}`, truncated: true };
}

// ── Anel ─────────────────────────────────────────────────────────────────

export interface Sequenced {
  readonly seq: number;
}

/** Buffer circular de capacidade fixa; `dropped` conta os descartados. */
export class RingBuffer<T extends Sequenced> {
  private readonly items: (T | undefined)[];
  private start = 0;
  private count = 0;
  public dropped = 0;

  public constructor(private readonly capacity: number) {
    this.items = new Array<T | undefined>(capacity);
  }

  public push(item: T): void {
    if (this.count < this.capacity) {
      this.items[(this.start + this.count) % this.capacity] = item;
      this.count += 1;
      return;
    }
    this.items[this.start] = item;
    this.start = (this.start + 1) % this.capacity;
    this.dropped += 1;
  }

  public get size(): number {
    return this.count;
  }

  /** Itens com seq > since que passam no filtro; os `limit` MAIS RECENTES, em ordem. */
  public tail(since: number, limit: number, filter?: (item: T) => boolean): T[] {
    const out: T[] = [];
    for (let i = this.count - 1; i >= 0 && out.length < limit; i -= 1) {
      const item = this.items[(this.start + i) % this.capacity] as T;
      if (item.seq <= since) break;
      if (filter === undefined || filter(item)) out.push(item);
    }
    return out.reverse();
  }

  public clear(): void {
    this.items.fill(undefined);
    this.start = 0;
    this.count = 0;
  }
}

export function clampTailLimit(limit: number | undefined): number {
  if (limit === undefined) return DEVBRIDGE_DEFAULT_TAIL_LIMIT;
  return Math.min(DEVBRIDGE_MAX_TAIL_LIMIT, Math.max(1, Math.floor(limit)));
}

// ── Console / erros ──────────────────────────────────────────────────────

const LEVEL_RANK: Readonly<Record<CapturedLogLevel, number>> = {
  debug: 0,
  log: 1,
  info: 1,
  warn: 2,
  error: 3,
};

const CONSOLE_LEVELS: readonly CapturedLogLevel[] = ["debug", "log", "info", "warn", "error"];

export function formatLogArgs(args: readonly unknown[]): string {
  const parts: string[] = [];
  for (const arg of args) {
    if (typeof arg === "string") {
      parts.push(arg);
      continue;
    }
    if (arg instanceof Error) {
      parts.push(arg.stack ?? `${arg.name}: ${arg.message}`);
      continue;
    }
    try {
      parts.push(JSON.stringify(toJsonSafe(arg, { maxDepth: 4, maxKeys: 30, maxArrayItems: 30 })));
    } catch {
      parts.push(String(arg));
    }
  }
  const text = parts.join(" ");
  return text.length > DEVBRIDGE_MAX_LOG_MESSAGE_BYTES ? `${text.slice(0, DEVBRIDGE_MAX_LOG_MESSAGE_BYTES)}…` : text;
}

type ConsoleMethod = (...args: unknown[]) => void;

/**
 * Envolve console.* (mantendo os originais, que continuam sendo chamados) e
 * escuta `error`/`unhandledrejection` do window. `uninstall()` restaura tudo.
 */
export class LogCapture {
  private readonly buffer = new RingBuffer<CapturedLog>(DEVBRIDGE_LOG_BUFFER_SIZE);
  private seq = 0;
  private readonly originals = new Map<CapturedLogLevel, ConsoleMethod>();
  private installedOn: { console: Console; target: EventTarget | null } | null = null;
  private recording = false;

  private readonly onWindowError = (event: Event): void => {
    const e = event as ErrorEvent;
    const where = e.filename ? ` (${e.filename}:${e.lineno ?? 0}:${e.colno ?? 0})` : "";
    const message = e.error instanceof Error ? formatLogArgs([e.error]) : `${e.message ?? "erro"}${where}`;
    this.record("error", message, "window.error");
  };

  private readonly onUnhandledRejection = (event: Event): void => {
    const reason = (event as PromiseRejectionEvent).reason;
    this.record("error", `Promise rejeitada sem tratamento: ${formatLogArgs([reason])}`, "unhandledrejection");
  };

  public install(target: Console = console, windowTarget: EventTarget | null = typeof window !== "undefined" ? window : null): void {
    if (this.installedOn !== null) return;
    this.installedOn = { console: target, target: windowTarget };
    const mutable = target as unknown as Record<string, ConsoleMethod>;
    for (const level of CONSOLE_LEVELS) {
      const original = mutable[level];
      if (typeof original !== "function") continue;
      this.originals.set(level, original);
      mutable[level] = (...args: unknown[]): void => {
        this.record(level, null, "console", args);
        original.apply(target, args);
      };
    }
    windowTarget?.addEventListener("error", this.onWindowError);
    windowTarget?.addEventListener("unhandledrejection", this.onUnhandledRejection);
  }

  public uninstall(): void {
    const installed = this.installedOn;
    if (installed === null) return;
    const mutable = installed.console as unknown as Record<string, ConsoleMethod>;
    for (const [level, original] of this.originals) mutable[level] = original;
    this.originals.clear();
    installed.target?.removeEventListener("error", this.onWindowError);
    installed.target?.removeEventListener("unhandledrejection", this.onUnhandledRejection);
    this.installedOn = null;
  }

  public record(level: CapturedLogLevel, message: string | null, origin: string, args?: readonly unknown[]): void {
    // Reentrância (ex.: toJSON que loga) não pode recursar.
    if (this.recording) return;
    this.recording = true;
    try {
      this.seq += 1;
      this.buffer.push({
        seq: this.seq,
        ts: Date.now(),
        level,
        message: message ?? formatLogArgs(args ?? []),
        origin,
      });
    } catch {
      // nunca quebrar o console do jogo
    } finally {
      this.recording = false;
    }
  }

  public tail(params: { since?: number; limit?: number; level?: CapturedLogLevel }): {
    lastSeq: number;
    dropped: number;
    logs: CapturedLog[];
  } {
    const minRank = params.level === undefined ? 0 : LEVEL_RANK[params.level];
    return {
      lastSeq: this.seq,
      dropped: this.buffer.dropped,
      logs: this.buffer.tail(params.since ?? 0, clampTailLimit(params.limit), (l) => LEVEL_RANK[l.level] >= minRank),
    };
  }
}

export function isCapturedLogLevel(value: unknown): value is CapturedLogLevel {
  return typeof value === "string" && value in LEVEL_RANK;
}

// ── Eventos do kernel ────────────────────────────────────────────────────

export interface EnvelopeLike {
  readonly type: string;
  readonly payload: unknown;
  readonly meta?: { readonly source?: string; readonly timestamp?: number };
}

/**
 * Buffer de eventos filtrado por globs. Curingas não pegam os eventos de
 * alta frequência (`game.loop.tick`/`render`): cite-os exatamente.
 */
export class EventCapture {
  private readonly buffer = new RingBuffer<CapturedEvent>(DEVBRIDGE_EVENT_BUFFER_SIZE);
  private seq = 0;
  private patterns: string[] = [...DEVBRIDGE_DEFAULT_EVENT_PATTERNS];
  private matchers: RegExp[] = this.patterns.map(devBridgeGlobToRegExp);
  private readonly decisionCache = new Map<string, boolean>();

  public setPatterns(patterns: readonly string[]): void {
    this.patterns = [...patterns];
    this.matchers = this.patterns.map(devBridgeGlobToRegExp);
    this.decisionCache.clear();
  }

  public getPatterns(): readonly string[] {
    return this.patterns;
  }

  public matches(type: string): boolean {
    const cached = this.decisionCache.get(type);
    if (cached !== undefined) return cached;
    let result: boolean;
    if (DEVBRIDGE_NOISY_EVENTS.includes(type)) {
      result = this.patterns.includes(type);
    } else {
      result = this.matchers.some((re) => re.test(type));
    }
    if (this.decisionCache.size < 4096) this.decisionCache.set(type, result);
    return result;
  }

  public onEnvelope(env: EnvelopeLike): void {
    try {
      if (!this.matches(env.type)) return;
      const bounded = toBoundedJson(env.payload, DEVBRIDGE_MAX_EVENT_PAYLOAD_BYTES);
      this.seq += 1;
      this.buffer.push({
        seq: this.seq,
        ts: env.meta?.timestamp ?? Date.now(),
        type: env.type,
        source: env.meta?.source ?? "?",
        payload: bounded.value,
        truncated: bounded.truncated,
      });
    } catch {
      // captura nunca afeta o jogo
    }
  }

  public tail(params: { since?: number; limit?: number }): {
    patterns: readonly string[];
    lastSeq: number;
    dropped: number;
    events: CapturedEvent[];
  } {
    return {
      patterns: this.patterns,
      lastSeq: this.seq,
      dropped: this.buffer.dropped,
      events: this.buffer.tail(params.since ?? 0, clampTailLimit(params.limit)),
    };
  }
}
