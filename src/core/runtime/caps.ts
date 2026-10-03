// @ai-why:  require/await/provide são a API de capability. await usa waiters (não polling); provide acorda waiters.
// @ai-link: internal/capability-waiters.ts, internal/resolver.ts
// @ai-keep: provide() chama notify() de forma síncrona. Não introduza await entre attachValue e notify.

// src/core/runtime/caps.ts
//
// CHANGED: `await` usa `state.capabilityWaiters` em vez de polling de
// 25ms. `provide` notifica os waiters pendentes. Mesma semântica, custo
// O(1) em vez de O(tempo).

import type { KernelState } from "./state";
import type {
  CapabilityApi,
  CapabilityAwaitOptions,
  CapabilityDescriptor,
} from "../contracts/plugin-context";
import type {
  CapabilityToken,
  AsyncCapabilityToken,
} from "../contracts/capability-token";
import { KernelError } from "../contracts/errors";
import { emitCapabilityChanged } from "./lifecycle-events";
import { assertCanUseCapability } from "./permissions";

export function makeCapsApi(state: KernelState, pluginId: string): CapabilityApi {
  function assertConsumes(token: { id: string }): { optional: boolean } {
    const entry = state.registry.mustGet(pluginId);
    const declared = entry.manifest.capabilities?.consumes?.find(
      (c) => c.id === token.id,
    );
    if (!declared) {
      throw new KernelError(
        "CAPABILITY_MISSING",
        `plugin "${pluginId}" chamou require("${token.id}") sem declarar consumes`,
        { pluginId, capabilityId: token.id },
      );
    }
    assertCanUseCapability(entry.manifest, token.id);
    return { optional: declared.optional === true };
  }

  return {
    require<T>(token: CapabilityToken<T>): T {
      const { optional } = assertConsumes(token);
      const st = state.resolver.getBindingState(pluginId, token.id);
      if (st.status === "resolved") return st.value as T;
      if (st.status === "pending") {
        throw new KernelError(
          "CAPABILITY_MISSING",
          `capability "${token.id}" ainda não tem valor`,
          { pluginId, capabilityId: token.id, providerId: st.providerId },
        );
      }
      if (optional) return undefined as unknown as T;

      // Mensagem explícita durante a fase de setup.
      if (state.phase === "setup") {
        throw new KernelError(
          "CAPABILITY_MISSING",
          `capability "${token.id}" não está resolvida DURANTE o setup. ` +
            `Bindings só existem após todos os setup() terminarem. ` +
            `Mova o consumo para lifecycle.onBoot() ou use ctx.caps.await().`,
          { pluginId, capabilityId: token.id, phase: state.phase },
        );
      }
      throw new KernelError(
        "CAPABILITY_MISSING",
        `capability "${token.id}" não tem provider elegível`,
        { pluginId, capabilityId: token.id },
      );
    },

    async await<T>(
      token: CapabilityToken<T> | AsyncCapabilityToken<T>,
      opts: CapabilityAwaitOptions = {},
    ): Promise<T> {
      assertConsumes(token);
      const timeoutMs = opts.timeoutMs ?? state.readyTimeoutMs;

      // fast path: valor já disponível.
      const st = state.resolver.getBindingState(pluginId, token.id);
      if (st.status === "resolved") return st.value as T;
      if (st.status === "unbound" && st.reason === "no_provider") {
        // requerimento não-opcional sem provider — não adianta esperar.
        // Mas deixa o waiter com timeout pra dar mensagem correta se
        // um provider aparecer.
      }
      // slow path: notificação.
      const value = await state.capabilityWaiters.waitFor<unknown>(
        pluginId,
        token.id,
        timeoutMs,
      );
      return value as T;
    },

    get<T>(token: CapabilityToken<T> | AsyncCapabilityToken<T>): T | undefined {
      assertConsumes(token);
      const st = state.resolver.getBindingState(pluginId, token.id);
      return st.status === "resolved" ? (st.value as T) : undefined;
    },

    provide<T>(
      token: CapabilityToken<T> | AsyncCapabilityToken<T>,
      value: T,
    ): void {
      assertCanUseCapability(state.registry.mustGet(pluginId).manifest, token.id);
      let normalized = value;
      if (token.schema) {
        try {
          normalized = token.schema.parse(value);
        } catch (err) {
          throw new KernelError(
            "CAPABILITY_SCHEMA_INVALID",
            `valor inválido para "${token.id}": ${String(err)}`,
            { pluginId, capabilityId: token.id, err: String(err) },
          );
        }
      }
      state.capabilities.attachValue(pluginId, token.id, normalized);
      state.capabilityWatchers.notify(token.id, normalized);
      // NEW: acorda awaits pendentes.
      state.capabilityWaiters.notifyAvailable(token.id, normalized);
      void emitCapabilityChanged(state, token.id, pluginId, "provided");
    },

    watch<T>(
      token: CapabilityToken<T> | AsyncCapabilityToken<T>,
      cb: (value: T | undefined) => void,
    ): () => void {
      assertConsumes(token);
      const dispose = state.capabilityWatchers.add({
        pluginId,
        capabilityId: token.id,
        cb: cb as (value: unknown) => void,
      });
      const st = state.resolver.getBindingState(pluginId, token.id);
      const initial = st.status === "resolved" ? (st.value as T) : undefined;
      try {
        cb(initial);
      } catch {
        /* watcher hostil */
      }
      return dispose;
    },

    list(): readonly CapabilityDescriptor[] {
      return state.capabilities.allCapabilityIds().map((id) => ({
        id,
        version: "1.0.0",
        providers: state.capabilities.providersOf(id).map((p) => ({
          pluginId: p.pluginId,
          version: p.provision.version,
          priority: p.provision.priority ?? 0,
          description: p.provision.description,
        })),
      }));
    },

    has(id: string): boolean {
      return state.capabilities.providersOf(id).length > 0;
    },

    requireById(id: string): unknown {
      assertConsumes({ id });
      const providers = state.capabilities.providersOf(id);
      if (providers.length === 0) {
        throw new KernelError("CAPABILITY_MISSING", `"${id}" sem provider`, {
          pluginId,
          capabilityId: id,
        });
      }
      const top = providers[0]!;
      if (!top.hasValue) {
        throw new KernelError(
          "CAPABILITY_MISSING",
          `"${id}" tem provider mas sem valor`,
          { pluginId, capabilityId: id, provider: top.pluginId },
        );
      }
      return top.value;
    },

    getById(id: string): unknown | undefined {
      assertConsumes({ id });
      const st = state.resolver.getBindingState(pluginId, id);
      return st.status === "resolved" ? st.value : undefined;
    },
  };
}