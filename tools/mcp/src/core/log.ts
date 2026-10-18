/**
 * Log do servidor MCP. SEMPRE em stderr: stdout é o canal do protocolo.
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
  /** Logger filho com prefixo (ex.: nome do domínio). */
  child(scope: string): Logger;
}

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export function parseLogLevel(value: string | undefined, fallback: LogLevel = "info"): LogLevel {
  if (value && value in ORDER) return value as LogLevel;
  return fallback;
}

export type LogSink = (line: string) => void;

const stderrSink: LogSink = (line) => {
  process.stderr.write(line + "\n");
};

function formatData(data: unknown): string {
  if (data === undefined) return "";
  if (data instanceof Error) return " " + (data.stack ?? data.message);
  try {
    return " " + JSON.stringify(data);
  } catch {
    return " " + String(data);
  }
}

export function createLogger(level: LogLevel = "info", scope = "engine-mcp", sink: LogSink = stderrSink): Logger {
  const min = ORDER[level];
  const emit = (lvl: Exclude<LogLevel, "silent">, message: string, data?: unknown): void => {
    if (ORDER[lvl] < min) return;
    sink(`[${scope}] ${lvl}: ${message}${formatData(data)}`);
  };
  return {
    debug: (m, d) => emit("debug", m, d),
    info: (m, d) => emit("info", m, d),
    warn: (m, d) => emit("warn", m, d),
    error: (m, d) => emit("error", m, d),
    child: (s) => createLogger(level, `${scope}:${s}`, sink),
  };
}

export const silentLogger: Logger = createLogger("silent");
