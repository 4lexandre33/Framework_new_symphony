// src/core/runtime/services.ts
//
// Constrói a API `ctx.services` — o Service Locator do kernel.
//
// `require` / `await` são a versão tipada (importam o token).
// `requireById` / `awaitById` são a versão "por nome": zero import de
// token do consumidor. Ambas compartilham a mesma resolução.

import type { KernelState } from "./state";
import type { ServiceApi } from "../contracts/plugin-context";
import type {
  CapabilityToken,
  AsyncCapabilityToken,
} from "../contracts/capability-token";
import { KernelError } from "../contracts/errors";
import { assertCanUseCapability } from "./permissions";

type AnyToken<T = unknown> = CapabilityToken<T> | AsyncCapabilityToken<T>;

export function createServiceApi(
  state: KernelState,
  pluginId: string,
): ServiceApi {
  const manifest = () => state.registry.mustGet(pluginId).manifest;
  const proxyCache = new Map<string, object>();

  function assertDeclared(id: string): void {
    if (!state.serviceTokens.has(id)) {
      throw new KernelError(
        "CAPABILITY_MISSING",
        `token "${id}" não foi declarado por nenhum plugin nem pelo kernel`,
        { pluginId, capabilityId: id },
      );
    }
  }

  function assertConsumes(id: string): { optional: boolean } {
    const declared = manifest().capabilities?.consumes?.find(
      (c) => c.id === id,
    );
    if (!declared) {
      throw new KernelError(
        "CAPABILITY_MISSING",
        `plugin "${pluginId}" chamou require("${id}") sem declarar consumes`,
        { pluginId, capabilityId: id },
      );
    }
    assertCanUseCapability(manifest(), id);
    return { optional: declared.optional === true };
  }

  function readFast(id: string): unknown | typeof MISSING {
    const st = state.resolver.getBindingState(pluginId, id);
    if (st.status === "resolved") return st.value;
    return MISSING;
  }

  return {
    declare<T>(token: AnyToken<T>): () => void {
      const dispose = state.serviceTokens.declare(pluginId, token);
      // O dispose do token precisa correr no dispose do plugin.
      // Usamos o array de disposers já existente via `trackDisposer`
      // implícito — chamado pelo runtime no `disposePlugin`.
      const list = state.disposers.get(pluginId) ?? [];
      list.push(dispose);
      state.disposers.set(pluginId, list);
      return dispose;
    },

    require<T>(token: CapabilityToken<T>): T {
      assertDeclared(token.id);
      const { optional } = assertConsumes(token.id);
      const st = state.resolver.getBindingState(pluginId, token.id);
      if (st.status === "resolved") return st.value as T;
      if (st.status === "pending") {
        throw new KernelError(
          "CAPABILITY_MISSING",
          `capability "${token.id}" tem provider "${st.providerId}" mas sem valor anexado`,
          { pluginId, capabilityId: token.id, providerId: st.providerId },
        );
      }
      if (optional) return undefined as unknown as T;
      throw new KernelError(
        "CAPABILITY_MISSING",
        `capability "${token.id}" não tem provider elegível`,
        { pluginId, capabilityId: token.id },
      );
    },

    requireById<T = unknown>(id: string): T {
      assertDeclared(id);
      const { optional } = assertConsumes(id);
      const st = state.resolver.getBindingState(pluginId, id);
      if (st.status === "resolved") return st.value as T;
      if (st.status === "pending") {
        throw new KernelError(
          "CAPABILITY_MISSING",
          `capability "${id}" tem provider "${st.providerId}" mas sem valor anexado`,
          { pluginId, capabilityId: id, providerId: st.providerId },
        );
      }
      if (optional) return undefined as unknown as T;
      throw new KernelError(
        "CAPABILITY_MISSING",
        `capability "${id}" não tem provider elegível`,
        { pluginId, capabilityId: id },
      );
    },

    async await<T>(token: AnyToken<T>): Promise<T> {
      assertDeclared(token.id);
      const { optional } = assertConsumes(token.id);
      const fast = readFast(token.id);
      if (fast !== MISSING) return fast as T;
      if (optional) {
        // opcional sem valor → devolve undefined imediatamente
        const st = state.resolver.getBindingState(pluginId, token.id);
        if (st.status !== "pending") return undefined as unknown as T;
      }
      const value = await state.capabilityWaiters.waitFor<unknown>(
        pluginId,
        token.id,
        state.readyTimeoutMs,
      );
      return value as T;
    },

    awaitById<T = unknown>(id: string, timeoutMs?: number): Promise<T> {
      assertDeclared(id);
      assertConsumes(id);
      const fast = readFast(id);
      if (fast !== MISSING) return Promise.resolve(fast as T);
      return state.capabilityWaiters.waitFor<T>(
        pluginId,
        id,
        timeoutMs ?? state.readyTimeoutMs,
      );
    },

    proxy<T extends object>(tokenOrId: AnyToken<T> | string): T {
      const id = typeof tokenOrId === "string" ? tokenOrId : tokenOrId.id;
      assertDeclared(id);
      assertConsumes(id);
      const cached = proxyCache.get(id);
      if (cached) return cached as T;

      const current = (): object => {
        const st = state.resolver.getBindingState(pluginId, id);
        if (st.status !== "resolved" || (typeof st.value !== "object" && typeof st.value !== "function") || st.value === null) {
          throw new KernelError("CAPABILITY_MISSING", `service "${id}" não está disponível como objeto`, { pluginId, capabilityId: id });
        }
        return st.value as object;
      };

      const proxy = new Proxy({}, {
        get(_target, prop) {
          const now = current();
          const value = Reflect.get(now, prop, now);
          if (typeof value !== "function") return value;
          return (...args: unknown[]) => {
            const latest = current();
            const fn = Reflect.get(latest, prop, latest);
            if (typeof fn !== "function") throw new TypeError(String(prop) + " deixou de ser método");
            return Reflect.apply(fn, latest, args);
          };
        },
        has(_target, prop) { return prop in current(); },
        ownKeys() { return Reflect.ownKeys(current()); },
        getOwnPropertyDescriptor(_target, prop) {
          const d = Reflect.getOwnPropertyDescriptor(current(), prop);
          return d ? { ...d, configurable: true } : undefined;
        },
      });
      proxyCache.set(id, proxy);
      return proxy as T;
    },

    list(): readonly { id: string; version: string; owner: string }[] {
      return state.serviceTokens.list().map((token) => ({
        id: token.id,
        version: token.version,
        owner: state.serviceTokens.ownerOf(token.id) ?? "unknown",
      }));
    },

    watch<T = unknown>(
      id: string,
      cb: (value: T | undefined) => void,
    ): () => void {
      assertDeclared(id);
      assertConsumes(id);
      const dispose = state.capabilityWatchers.add({
        pluginId,
        capabilityId: id,
        cb: cb as (value: unknown) => void,
      });
      const st = state.resolver.getBindingState(pluginId, id);
      const initial =
        st.status === "resolved" ? (st.value as T) : undefined;
      try {
        cb(initial);
      } catch {
        /* watcher hostil */
      }
      return dispose;
    },
  };
}

/** Sentinela local. Distinta de `undefined` porque uma capability pode ter `undefined` como valor. */
const MISSING = Symbol("capability-missing");