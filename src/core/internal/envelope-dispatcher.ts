import { KernelError } from "../contracts/errors";
import type {
  CapabilityHandler,
  DispatchEnvelope,
  DispatchResult,
} from "../contracts/dispatch-envelope";

/**
 * Despacho por envelope, indexado por `{capability}@{version}#{method}`.
 * Um método só pode ter um handler. Isolado do `Dispatcher` de
 * commands/queries — são caminhos diferentes.
 */
export class EnvelopeDispatcher {
  private readonly handlers = new Map<string, CapabilityHandler>();

  register(handler: CapabilityHandler): void {
    const key = this.keyOf(handler.capability, handler.version, handler.method);
    const existing = this.handlers.get(key);
    if (existing) {
      throw new KernelError(
        "DISPATCH_MULTIPLE_HANDLERS",
        `handler "${key}" já registrado por "${existing.provider}"`,
        { key, existingProvider: existing.provider, newProvider: handler.provider },
      );
    }
    this.handlers.set(key, handler);
  }

  async dispatch<T = unknown>(envelope: DispatchEnvelope): Promise<DispatchResult<T>> {
    if (!envelope?.capability || !envelope.version || !envelope.type) {
      return { ok: false, error: "envelope sem capability/version/type" };
    }
    const key = this.keyOf(envelope.capability, envelope.version, envelope.type);
    const handler = this.handlers.get(key);
    if (!handler) {
      return { ok: false, error: `handler "${key}" não encontrado` };
    }
    try {
      const value = (await handler.handle(envelope.payload)) as T;
      return { ok: true, value };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  list(): readonly {
    capability: string;
    version: string;
    method: string;
    provider: string;
  }[] {
    return [...this.handlers.values()].map((h) => ({
      capability: h.capability,
      version: h.version,
      method: h.method,
      provider: h.provider,
    }));
  }

  disposePlugin(pluginId: string): void {
    for (const [key, handler] of this.handlers) {
      if (handler.provider === pluginId) this.handlers.delete(key);
    }
  }

  private keyOf(capability: string, version: string, method: string): string {
    return `${capability}@${version}#${method}`;
  }
}