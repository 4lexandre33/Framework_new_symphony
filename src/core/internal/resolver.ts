// src/core/internal/resolver.ts
//
// CHANGED: adicionado `getBindingState` que distingue três estados:
//   - unbound  → plugin não declarou consumes, ou requerimento não tem provider elegível
//   - pending  → provider elegível existe, mas não anexou valor ainda
//   - resolved → valor disponível
//
// Isso corrige a ambiguidade do `getBindingValue` (que retornava
// `undefined` para os três casos) e permite que `ctx.services.require`
// dê mensagens corretas em vez de "ainda não tem valor" genérico.

import type { Binding, CapabilityRegistry } from "./capability-registry";

export type BindingState =
  | { status: "unbound"; reason: "not_declared" | "no_provider" }
  | { status: "pending"; providerId: string }
  | { status: "resolved"; value: unknown; providerId: string };

export class Resolver {
  private readonly bindingsByPlugin = new Map<string, Binding[]>();

  constructor(private readonly registry: CapabilityRegistry) {}

  /** Chamado depois que TODOS os plugins declararam provides. */
  resolvePlugin(pluginId: string): Binding[] {
    const bindings = this.registry.resolveFor(pluginId);
    this.bindingsByPlugin.set(pluginId, bindings);
    return bindings;
  }

  /**
   * @deprecated Use `getBindingState`. Mantido por compatibilidade
   * binária com devtools e código legado.
   */
  getBindingValue(pluginId: string, capabilityId: string): unknown {
    const st = this.getBindingState(pluginId, capabilityId);
    return st.status === "resolved" ? st.value : undefined;
  }

  /**
   * Estado explícito do binding. Preferir este.
   */
  getBindingState(pluginId: string, capabilityId: string): BindingState {
    const bindings = this.bindingsByPlugin.get(pluginId) ?? [];
    const binding = bindings.find((b) => b.requirement.id === capabilityId);
    if (!binding) {
      return { status: "unbound", reason: "not_declared" };
    }
    const provider = binding.provider;
    if (!provider) {
      // requirement não-opcional sem provider elegível → unbound
      if (binding.requirement.optional) {
        return {
          status: "resolved",
          value: undefined,
          providerId: "none",
        };
      }
      return { status: "unbound", reason: "no_provider" };
    }
    if (!provider.hasValue) {
      return { status: "pending", providerId: provider.pluginId };
    }
    return {
      status: "resolved",
      value: provider.value,
      providerId: provider.pluginId,
    };
  }

  /** True se o binding existe e já tem valor anexado. */
  hasValue(pluginId: string, capabilityId: string): boolean {
    return this.getBindingState(pluginId, capabilityId).status === "resolved";
  }

  getPending(pluginId: string): readonly string[] {
    const bindings = this.bindingsByPlugin.get(pluginId) ?? [];
    return bindings
      .filter((b) => !b.requirement.optional && b.provider !== undefined && !b.provider.hasValue)
      .map((b) => b.requirement.id);
  }

  forget(pluginId: string): void {
    this.bindingsByPlugin.delete(pluginId);
  }

  knownPlugins(): readonly string[] {
    return [...this.bindingsByPlugin.keys()];
  }

  rebindAll(
    pluginIds?: readonly string[],
    onError?: (pluginId: string, err: unknown) => void,
  ): void {
    const targets = pluginIds ?? this.knownPlugins();
    for (const id of targets) {
      try {
        this.resolvePlugin(id);
      } catch (err) {
        if (onError) onError(id, err);
        else throw err;
      }
    }
  }
}