import type { Logger, LogEntry, LoggerOptions, LogLevel } from "../contracts/logger";

const LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

const CORRELATION_KEY = "correlationId";
const TRACE_KEY = "trace";
const SEQ_KEY = "seq";

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asStringArray(v: unknown): readonly string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.every((x) => typeof x === "string") ? (v as string[]) : undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export type { LogEntry, LoggerOptions, LogLevel } from "../contracts/logger";

export function createLogger(pluginId: string, opts: LoggerOptions = {}): Logger {
  const minIndex = LEVELS.indexOf(opts.level ?? "info");
  const sink = opts.sink ?? defaultSink;
  const seqProvider = opts.seqProvider;

  const emit = (
    level: LogLevel,
    message: string,
    meta?: Record<string, unknown>,
  ): void => {
    if (LEVELS.indexOf(level) < minIndex) return;

    const correlationId =
      asString(meta?.[CORRELATION_KEY]) ?? opts.correlationId;
    const trace = asStringArray(meta?.[TRACE_KEY]) ?? opts.trace;
    const seq = asNumber(meta?.[SEQ_KEY]) ?? seqProvider?.();

    let cleanMeta = meta;
    if (meta) {
      const { [CORRELATION_KEY]: _c, [TRACE_KEY]: _t, [SEQ_KEY]: _s, ...rest } = meta;
      cleanMeta = Object.keys(rest).length > 0 ? rest : undefined;
    }

    const entry: LogEntry = {
      level,
      pluginId,
      message,
      meta: cleanMeta,
      timestamp: Date.now(),
      ...(correlationId !== undefined ? { correlationId } : {}),
      ...(trace !== undefined ? { trace } : {}),
      ...(seq !== undefined ? { seq } : {}),
    };
    sink(entry);
  };

  return {
    debug: (m, meta) => emit("debug", m, meta),
    info: (m, meta) => emit("info", m, meta),
    warn: (m, meta) => emit("warn", m, meta),
    error: (m, meta) => emit("error", m, meta),
  };
}

function defaultSink(entry: LogEntry): void {
  const tag = `[${entry.pluginId}]`;
  const fn =
    entry.level === "error"
      ? console.error
      : entry.level === "warn"
        ? console.warn
        : entry.level === "debug"
          ? console.debug
          : console.info;
  if (entry.meta) fn(tag, entry.message, entry.meta);
  else fn(tag, entry.message);
}