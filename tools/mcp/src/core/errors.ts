/**
 * Erros padronizados das tools do MCP da engine (SPEC §4).
 *
 * Toda falha esperada deve ser lançada como `McpToolError`; o registry
 * converte em `isError: true` + `{ code, message, hint? }`. Qualquer outra
 * exceção vira `INTERNAL`.
 */

export const ERROR_CODES = [
  "INVALID_INPUT",
  "NOT_FOUND",
  "PATH_OUTSIDE_REPO",
  "WRITE_FORBIDDEN",
  "READONLY",
  "PROJECT_EXISTS",
  "COMMAND_NOT_ALLOWED",
  "COMMAND_FAILED",
  "TIMEOUT",
  "JOB_LIMIT",
  "NO_RUNTIME",
  "BRIDGE_TIMEOUT",
  "BRIDGE_ERROR",
  "PLAYWRIGHT_MISSING",
  "SCHEMA_INVALID",
  "INTERNAL",
] as const;

export type KnownErrorCode = (typeof ERROR_CODES)[number];
/** Códigos conhecidos com autocomplete; domínios podem usar outros. */
export type ErrorCode = KnownErrorCode | (string & {});

export interface ToolErrorPayload {
  readonly code: ErrorCode;
  readonly message: string;
  readonly hint?: string;
  readonly details?: unknown;
}

export class McpToolError extends Error {
  readonly code: ErrorCode;
  readonly hint?: string;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, hint?: string, details?: unknown) {
    super(message);
    this.name = "McpToolError";
    this.code = code;
    if (hint !== undefined) this.hint = hint;
    if (details !== undefined) this.details = details;
  }

  toPayload(): ToolErrorPayload {
    return {
      code: this.code,
      message: this.message,
      ...(this.hint !== undefined ? { hint: this.hint } : {}),
      ...(this.details !== undefined ? { details: this.details } : {}),
    };
  }
}

export function isMcpToolError(value: unknown): value is McpToolError {
  return value instanceof McpToolError;
}

/** Atalho: `throw toolError("NOT_FOUND", "…")`. */
export function toolError(code: ErrorCode, message: string, hint?: string, details?: unknown): McpToolError {
  return new McpToolError(code, message, hint, details);
}
