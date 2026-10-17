import { PluginError } from "../contracts/errors";
import type { Logger } from "../contracts/logger";
import type { EventEnvelope } from "../contracts/envelope";

type AnyHandler = (env: EventEnvelope) => void | Promise<void>;

interface Listener {
  readonly pluginId: string;
  readonly fn: (env: EventEnvelope<string, unknown>) => void | Promise<void>;
}

export interface EventBusOptions {
  /**
   * Se true, um handler que lança faz `emit` rejeitar (via `PluginError`).
   * Default: false — erros viram log, o bus nunca derruba o kernel.
   */
  readonly strict?: boolean;
  /**
   * G30: chamado para cada handler que lança (depois do log). Nunca
   * derruba o bus: exceções do próprio callback são ignoradas.
   */
  readonly onHandlerError?: (pluginId: string, env: EventEnvelope, err: unknown) => void;
}

export class EventBus {
  private readonly handlers = new Map<string, Set<Listener>>();
  private readonly anyHandlers = new Set<{ pluginId: string; fn: AnyHandler }>();
  private readonly byPlugin = new Map<string, Set<() => void>>();
  private readonly strict: boolean;
  private readonly onHandlerError: EventBusOptions["onHandlerError"];

  constructor(private readonly logger: Logger, opts: EventBusOptions = {}) {
    this.strict = opts.strict ?? false;
    this.onHandlerError = opts.onHandlerError;
  }

  /**
   * Assina um tipo. O handler é tipado com `EventEnvelope<T, P>` —
   * mais específico que o `EventEnvelope<string, unknown>` interno,
   * então guardamos via cast depois de verificar a `type`.
   */
  on<T extends string, P>(
    pluginId: string,
    type: T,
    fn: (env: EventEnvelope<T, P>) => void | Promise<void>,
  ): () => void {
    const set = this.handlers.get(type) ?? new Set<Listener>();
    const entry: Listener = {
      pluginId,
      fn: fn as unknown as Listener["fn"],
    };
    set.add(entry);
    this.handlers.set(type, set);

    const dispose = () => {
      set.delete(entry);
      if (set.size === 0) this.handlers.delete(type);
      this.byPlugin.get(pluginId)?.delete(dispose);
    };
    this.trackDispose(pluginId, dispose);
    return dispose;
  }

  onAny(pluginId: string, fn: AnyHandler): () => void {
    const entry = { pluginId, fn };
    this.anyHandlers.add(entry);
    const dispose = () => {
      this.anyHandlers.delete(entry);
      this.byPlugin.get(pluginId)?.delete(dispose);
    };
    this.trackDispose(pluginId, dispose);
    return dispose;
  }

  /**
   * Executa todos os handlers "em paralelo": cada handler é INVOCADO
   * sincronamente, na ordem de inscrição, dentro desta chamada; só as partes
   * assíncronas (depois do primeiro `await`) se sobrepõem.
   *
   * - `strict: false` (default): NUNCA rejeita. Erros viram log +
   *   `onHandlerError` (G30).
   * - `strict: true`: rejeita no primeiro erro (Promise.all).
   */
  async emit(env: EventEnvelope): Promise<void> {
    const direct = this.handlers.get(env.type);
    const directCount = direct ? direct.size : 0;
    const total = directCount + this.anyHandlers.size;
    if (total === 0) return;
    if (total === 1) {
      // Caminho quente (ex.: game.loop.tick com 1 assinante): sem array.
      if (direct) {
        for (const h of direct) await this.invoke(h.pluginId, h.fn, env);
      } else {
        for (const h of this.anyHandlers) await this.invoke(h.pluginId, h.fn, env);
      }
      return;
    }
    const tasks: Array<Promise<void>> = [];
    if (direct) {
      for (const h of direct) tasks.push(this.invoke(h.pluginId, h.fn, env));
    }
    for (const h of this.anyHandlers) {
      tasks.push(this.invoke(h.pluginId, h.fn, env));
    }
    await Promise.all(tasks);
  }

  /** Alias explícito. Mesma semântica de `emit`. */
  async emitAsync(env: EventEnvelope): Promise<void> {
    await this.emit(env);
  }

  disposePlugin(pluginId: string): void {
    const disposers = this.byPlugin.get(pluginId);
    if (disposers) {
      for (const d of [...disposers]) {
        try {
          d();
        } catch {
          /* handler hostil */
        }
      }
      this.byPlugin.delete(pluginId);
    }
    for (const [type, set] of this.handlers) {
      for (const entry of [...set]) {
        if (entry.pluginId === pluginId) set.delete(entry);
      }
      if (set.size === 0) this.handlers.delete(type);
    }
    for (const entry of [...this.anyHandlers]) {
      if (entry.pluginId === pluginId) this.anyHandlers.delete(entry);
    }
  }

  private async invoke(
    pluginId: string,
    fn: (env: EventEnvelope) => void | Promise<void>,
    env: EventEnvelope,
  ): Promise<void> {
    try {
      await fn(env);
    } catch (err) {
      this.logger.error(`handler de "${pluginId}" falhou em "${env.type}"`, {
        err: String(err),
      });
      if (this.onHandlerError) {
        try {
          this.onHandlerError(pluginId, env, err);
        } catch {
          /* reporter hostil nunca derruba o bus */
        }
      }
      if (this.strict) {
        throw new PluginError(pluginId, "handler failed in strict mode", err);
      }
    }
  }

  private trackDispose(pluginId: string, dispose: () => void): void {
    const set = this.byPlugin.get(pluginId) ?? new Set();
    set.add(dispose);
    this.byPlugin.set(pluginId, set);
  }
}