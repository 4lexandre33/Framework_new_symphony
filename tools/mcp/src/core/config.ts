/**
 * Configuração do servidor via variáveis de ambiente (SPEC §2.1).
 *
 * | variável                 | padrão     | efeito                                         |
 * |--------------------------|------------|------------------------------------------------|
 * | `ENGINE_MCP_ROOT`        | detectado  | raiz do repositório                            |
 * | `ENGINE_MCP_BRIDGE_PORT` | `47100`    | porta do WebSocket do DevBridge                 |
 * | `ENGINE_MCP_READONLY`    | desligado  | `1`/`true` recusa toda escrita                 |
 * | `ENGINE_MCP_IMPORT_DIR`  | nenhum     | pasta extra de onde `asset_import` pode copiar |
 * | `ENGINE_MCP_LOG`         | `info`     | `debug`/`info`/`warn`/`error`/`silent`         |
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { McpToolError } from "./errors.ts";
import { parseLogLevel, type LogLevel } from "./log.ts";
import { detectRepoRoot } from "./paths.ts";

export const DEFAULT_BRIDGE_PORT = 47100;
export const DEFAULT_JOB_LIMIT = 4;

export interface EngineMcpConfig {
  readonly root: string;
  readonly bridgePort: number;
  readonly readonly: boolean;
  /** Pasta absoluta extra para importação de assets (ou `null`). */
  readonly importDir: string | null;
  readonly jobLimit: number;
  readonly logLevel: LogLevel;
}

function parseBool(value: string | undefined): boolean {
  if (value === undefined) return false;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return DEFAULT_BRIDGE_PORT;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new McpToolError("INVALID_INPUT", `ENGINE_MCP_BRIDGE_PORT inválida: ${value}`, "Use um inteiro entre 1 e 65535.");
  }
  return n;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<EngineMcpConfig> = {},
): EngineMcpConfig {
  const root = overrides.root ?? detectRepoRoot(env);
  const importRaw = env.ENGINE_MCP_IMPORT_DIR?.trim();
  let importDir: string | null = null;
  if (importRaw) {
    importDir = path.resolve(importRaw);
    if (!existsSync(importDir)) {
      throw new McpToolError("NOT_FOUND", `ENGINE_MCP_IMPORT_DIR não existe: ${importDir}`);
    }
  }
  return {
    root,
    bridgePort: overrides.bridgePort ?? parsePort(env.ENGINE_MCP_BRIDGE_PORT),
    readonly: overrides.readonly ?? parseBool(env.ENGINE_MCP_READONLY),
    importDir: overrides.importDir !== undefined ? overrides.importDir : importDir,
    jobLimit: overrides.jobLimit ?? DEFAULT_JOB_LIMIT,
    logLevel: overrides.logLevel ?? parseLogLevel(env.ENGINE_MCP_LOG),
  };
}
