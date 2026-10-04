import { guardAsync } from "./error-boundary";
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
}

export class EventBus {
  private readonly handlers = new Map<string, Set<Listener>>();
  private readonly anyHandlers = new Set<{ pluginId: string; fn: AnyHandler }>();
  private readonly byPlugin = new Map<string, Set<() => void>>();
  private readonly strict: boolean;

  constructor(private readonly logger: Logger, opts: EventBusOptions = {}) {
    this.strict = opts.strict ?? false;
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
   * Executa todos os handlers em paralelo.
   *
   * - `strict: false` (default): NUNCA rejeita. Erros viram log.
   * - `strict: true`: rejeita no primeiro erro (Promise.all).
   */
  async emit(env: EventEnvelope): Promise<void> {
    const tasks: Array<Promise<unknown>> = [];
    const direct = this.handlers.get(env.type);
    if (direct) {
      for (const h of direct) {
        tasks.push(this.guard(h.pluginId, () => h.fn(env)));
      }
    }
    for (const h of this.anyHandlers) {
      tasks.push(this.guard(h.pluginId, () => h.fn(env)));
    }
    if (tasks.length === 0) return;
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

  private guard<T>(pluginId: string, fn: () => Promise<T> | T): Promise<T | undefined> {
    return guardAsync(pluginId, this.logger, fn, { strict: this.strict });
  }

  private trackDispose(pluginId: string, dispose: () => void): void {
    const set = this.byPlugin.get(pluginId) ?? new Set();
    set.add(dispose);
    this.byPlugin.set(pluginId, set);
  }
}