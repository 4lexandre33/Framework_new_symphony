import type { LoggerOptions } from "./logger";
import type { HandlerErrorHook } from "./handler-error";

export type UserPluginConfigs = Readonly<
  Record<string, Readonly<Record<string, unknown>>>
>;

export interface KernelOptions {
  readonly logger?: LoggerOptions;

  /** Falhas de setup/config não abortam o boot — plugin fica "failed". */
  readonly tolerant?: boolean;

  /**
   * Handlers de EVENTO que lançam fazem `emitAsync` rejeitar (com
   * `PluginError`). Default false: o erro é reportado (ver `onHandlerError`
   * e `kernel.handler.error`) e os outros handlers seguem.
   *
   * Commands e queries SEMPRE rejeitam quando o handler lança (G29); com
   * `strict` o erro de command chega embrulhado em `PluginError`.
   */
  readonly strict?: boolean;

  /**
   * G30: chamado de forma síncrona para cada exceção de handler de
   * evento/command/query, antes do evento `kernel.handler.error`.
   * Exceções lançadas pelo próprio hook são ignoradas.
   */
  readonly onHandlerError?: HandlerErrorHook;

  /** Config do usuário por plugin, com precedência sobre os defaults. */
  readonly configs?: UserPluginConfigs;

  /** Fonte de env exposta via `ctx.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;

  /** Timeout total para boot(). 0 desliga. Default 30000. */
  readonly bootTimeoutMs?: number;

  /** Timeout para stop(). 0 desliga. Default 15000. */
  readonly stopTimeoutMs?: number;

  /** Timeout de readiness por plugin. 0 desliga. Default 10000. */
  readonly readyTimeoutMs?: number;

  /** TTL default para send/ask/emitAsync. 0 desliga. Default 30000. */
  readonly defaultTtlMs?: number;

  /** Permite register() após boot(). Default false. */
  readonly allowLateRegistration?: boolean;

  /** Concorrência máxima da fila de emit fire-and-forget. Default 8. */
  readonly emitConcurrency?: number;

  /**
   * Política de camada. Default `false`: um plugin internal/preloaded
   * NÃO pode consumir capability cujo único provider seja external.
   * Setar `true` suspende essa regra (auditável, mas quebra o isolamento).
   */
  readonly allowInternalConsumeExternal?: boolean;

  /**
   * Se `true`, `ctx.slots.contribute()` exige que `manifest.contributesTo`
   * declare o slot. Default `false` para não quebrar plugins existentes.
   */
  readonly enforceSlotContributions?: boolean;
}