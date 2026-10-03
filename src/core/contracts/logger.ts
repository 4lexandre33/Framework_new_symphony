export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  readonly level: LogLevel;
  readonly pluginId: string;
  readonly message: string;
  readonly meta?: Record<string, unknown>;
  readonly timestamp: number;
  readonly correlationId?: string;
  readonly trace?: readonly string[];
  readonly seq?: number;
}

export interface LoggerOptions {
  level?: LogLevel;
  sink?: (entry: LogEntry) => void;
  correlationId?: string;
  trace?: readonly string[];
  seqProvider?: () => number;
}

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}