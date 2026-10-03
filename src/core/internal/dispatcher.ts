import { KernelError } from "../contracts/errors";
import { guardAsync } from "./error-boundary";
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
  /** Se true, handler que lança rejeita o `send` correspondente. */
  readonly strict?: boolean;
}

export class Dispatcher {
  private readonly commandHandlers = new Map<string, CommandListener>();
  private readonly queryHandlers = new Map<string, { pluginId: string; fn: QueryHandler }>();
  private readonly strict: boolean;

  constructor(
    private readonly logger: Logger,
    opts: DispatcherOptions = {},
  ) {
    this.strict = opts.strict ?? false;
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
   * Honra `strict`: erro do handler rejeita quando strict=true.
   */
  async send(env: CommandEnvelope, signal: AbortSignal): Promise<void> {
    const h = this.commandHandlers.get(env.type);
    if (!h) return;
    const ctx: HandlerCtx = { signal };
    await guardAsync(h.pluginId, this.logger, () => h.fn(env, ctx), {
      strict: this.strict,
    });
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
      this.logger.error(`handler de "${pluginId}" falhou em ask("${env.type}")`, {
        err: String(err),
      });
      throw err;
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
