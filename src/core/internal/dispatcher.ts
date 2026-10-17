import { KernelError, PluginError } from "../contracts/errors";
import type { Logger, HandlerCtx } from "../contracts/plugin-context";
import type { CommandEnvelope, QueryEnvelope } from "../contracts/envelope";

type CommandHandler = (
  env: CommandEnvelope<string, unknown>,
  ctx: HandlerCtx,
) => unknown;
type QueryHandler = (
  env: QueryEnvelope<string, unknown>,
  ctx: HandlerCtx,
) => unknown;

interface CommandListener {
  readonly pluginId: string;
  readonly fn: CommandHandler;
}

export interface DispatcherOptions {
  /**
   * Se true, o erro de um handler de command chega ao `send` embrulhado em
   * `PluginError` (com `cause`). Se false, o `send` rejeita com o erro
   * ORIGINAL. Em ambos os casos o `send` rejeita (G29).
   */
  readonly strict?: boolean;
  /** G30: chamado para cada handler de command/query que lança. */
  readonly onHandlerError?: (
    pluginId: string,
    kind: "command" | "query",
    env: CommandEnvelope | QueryEnvelope,
    err: unknown,
  ) => void;
}

export class Dispatcher {
  private readonly commandHandlers = new Map<string, CommandListener>();
  private readonly queryHandlers = new Map<string, { pluginId: string; fn: QueryHandler }>();
  private readonly strict: boolean;
  private readonly onHandlerError: DispatcherOptions["onHandlerError"];

  constructor(
    private readonly logger: Logger,
    opts: DispatcherOptions = {},
  ) {
    this.strict = opts.strict ?? false;
    this.onHandlerError = opts.onHandlerError;
  }

  /** true se existe handler registrado para o command. */
  hasCommandHandler(type: string): boolean {
    return this.commandHandlers.has(type);
  }

  /**
   * Aceita handler tipado com `CommandEnvelope<T, P>`. Cast interno
   * porque armazenamos com tipo apagado — mas o par (type, T) está
   * garantido pelo caller (o kernel recebe `env.type` e casa com o `type`).
   */
  handleCommand<T extends string, P>(
    type: T,
    pluginId: string,
    fn: (
      env: CommandEnvelope<T, P>,
      ctx: HandlerCtx,
    ) => unknown | Promise<unknown>,
  ): () => void {

    const existing = this.commandHandlers.get(type);
    if (existing) {
      throw new KernelError(
        "DISPATCH_MULTIPLE_HANDLERS",
        `command "${type}" já é tratado por "${existing.pluginId}"`,
        { type, existingPluginId: existing.pluginId, newPluginId: pluginId },
      );
    }
    const entry: CommandListener = {
      pluginId,
      fn: fn as unknown as CommandHandler,
    };
    this.commandHandlers.set(type, entry);
    return () => {
      if (this.commandHandlers.get(type) === entry) this.commandHandlers.delete(type);
    };
  }

  answerQuery<T extends string, P, R>(
    type: T,
    pluginId: string,
    fn: (env: QueryEnvelope<T, P>, ctx: HandlerCtx) => R | Promise<R>,
  ): () => void {

    const existing = this.queryHandlers.get(type);
    if (existing) {
      throw new KernelError(
        "DISPATCH_MULTIPLE_HANDLERS",
        `query "${type}" já é respondida por "${existing.pluginId}"`,
        { type, existingPluginId: existing.pluginId, newPluginId: pluginId },
      );
    }
    const entry = { pluginId, fn: fn as unknown as QueryHandler };
    this.queryHandlers.set(type, entry);
    return () => {
      if (this.queryHandlers.get(type) === entry) this.queryHandlers.delete(type);
    };
  }

  /**
   * Commands possuem uma única autoridade. EventBus é o mecanismo multicast.
   *
   * G29: resolve com o VALOR RETORNADO pelo handler (aguardado se for
   * Promise) e rejeita quando o handler lança (erro original; `PluginError`
   * com `cause` se `strict`). Sem handler: resolve `undefined`, ou rejeita
   * com `DISPATCH_NO_HANDLER` se `requireHandler`.
   */
  async send<R = unknown>(
    env: CommandEnvelope,
    signal: AbortSignal,
    requireHandler = false,
  ): Promise<R | undefined> {
    const h = this.commandHandlers.get(env.type);
    if (!h) {
      if (requireHandler) {
        throw new KernelError(
          "DISPATCH_NO_HANDLER",
          `nenhum handler para command "${env.type}"`,
          { type: env.type },
        );
      }
      return undefined;
    }
    const ctx: HandlerCtx = { signal };
    try {
      return (await h.fn(env, ctx)) as R;
    } catch (err) {
      this.report(h.pluginId, "command", env, err);
      if (this.strict) {
        throw new PluginError(h.pluginId, `handler failed in send("${env.type}")`, err);
      }
      throw err;
    }
  }

  /**
   * Queries: exatamente um handler, ou fallback, ou erro. Propaga o erro
   * do handler (não engole).
   */
  async ask<R>(env: QueryEnvelope, signal: AbortSignal, fallback?: R): Promise<R> {
    const entry = this.queryHandlers.get(env.type);
    if (!entry) {
      if (fallback !== undefined) return fallback;
      throw new KernelError(
        "DISPATCH_NO_HANDLER",
        `nenhum handler para query "${env.type}"`,
      );
    }
    const { pluginId, fn } = entry;
    const ctx: HandlerCtx = { signal };
    try {
      const result = await fn(env, ctx);
      return result as R;
    } catch (err) {
      this.report(pluginId, "query", env, err);
      throw err;
    }
  }

  private report(
    pluginId: string,
    kind: "command" | "query",
    env: CommandEnvelope | QueryEnvelope,
    err: unknown,
  ): void {
    this.logger.error(
      `handler de "${pluginId}" falhou em ${kind === "command" ? "send" : "ask"}("${env.type}")`,
      { err: String(err) },
    );
    if (this.onHandlerError) {
      try {
        this.onHandlerError(pluginId, kind, env, err);
      } catch {
        /* reporter hostil */
      }
    }
  }

  disposePlugin(pluginId: string): void {
    for (const [type, entry] of this.commandHandlers) {
      if (entry.pluginId === pluginId) this.commandHandlers.delete(type);
    }
    for (const [type, entry] of this.queryHandlers) {
      if (entry.pluginId === pluginId) this.queryHandlers.delete(type);
    }
  }
}