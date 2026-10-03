// @ai-why:  Ordem de teardown: abort → disposers → scope → timers → subsystems → capabilities → registry.
// @ai-link: internal/capability-waiters.ts, internal/service-token-registry.ts
// @ai-keep: waiters.disposePlugin e serviceTokens.disposeOwner são chamados aqui. Core tokens (owner='kernel') não são tocados.

// src/core/runtime/dispose.ts
//
// CHANGED: no cleanup, chama também
//   - `capabilityWaiters.disposePlugin(id)` (rejeita awaits pendentes)
//   - `serviceTokens.disposeOwner(id)` (remove tokens do plugin)
// Nenhuma dessas duas toca core tokens (owner = "kernel").

import type { KernelState } from "./state";
import { KernelError } from "../contracts/errors";
import { emitLifecycle } from "./lifecycle-events";

export interface DisposeOptions {
  /**
   * Se `true` (default), re-resolve consumidores das capabilities do
   * plugin sendo removido. Passe `false` em `replace()` (rebind após
   * registrar o novo) e em `stop()` (todos vão ser desmontados).
   */
  readonly rebindConsumers?: boolean;
  /** Uso interno em stop/replace depois de preflight próprio. */
  readonly force?: boolean;
  /** false durante hot-replace: waiters podem receber o provider substituto. */
  readonly notifyUnavailable?: boolean;
}

export async function disposePlugin(
  state: KernelState,
  id: string,
  opts: DisposeOptions = {},
): Promise<void> {
  const entry = state.registry.get(id);
  if (!entry || entry.state === "disposed") return;

  if (!opts.force) {
    const dependents = state.registry.dependentsOf(id);
    if (dependents.length > 0) {
      throw new KernelError(
        "PLUGIN_HAS_DEPENDENTS",
        `plugin "${id}" possui dependentes obrigatórios: ${dependents.join(", ")}`,
        { pluginId: id, dependents },
      );
    }
  }

  state.abortControllers.get(id)?.abort();
  await runDisposers(state, id);
  await runScope(state, id);
  stopTimers(state, id);
  detachSubsystems(state, id);
  notifyCapabilityRemoval(state, id, opts.notifyUnavailable !== false);
  cleanupRegistry(state, id);

  if (opts.rebindConsumers !== false) {
    rebindConsumersOf(state, id);
  }

  await emitLifecycle(state, "kernel.plugin.disposed", { pluginId: id });
}

/**
 * Re-resolve consumidores das capabilities providas pelo plugin `id`.
 * Chamado por `disposePlugin` (opt-out via opts) para que bindings
 * antigos não fiquem presos ao valor removido.
 */
export function rebindConsumersOf(state: KernelState, id: string): void {
  const entry = state.registry.get(id);
  if (!entry) return;
  const providedIds = new Set(
    (entry.manifest.capabilities?.provides ?? []).map((p) => p.id),
  );
  if (providedIds.size === 0) return;

  const consumers: string[] = [];
  for (const plugin of state.registry.all()) {
    if (plugin.manifest.id === id) continue;
    const cs = plugin.manifest.capabilities?.consumes ?? [];
    if (cs.some((c) => providedIds.has(c.id))) consumers.push(plugin.manifest.id);
  }
  if (consumers.length === 0) return;

  state.resolver.rebindAll(consumers, (consumerId, err) => {
    state.rootLog.warn(`rebind de "${consumerId}" falhou após dispose`, {
      err: String(err),
    });
    state.registry.setState(consumerId, "failed", err);
  });
}

async function runDisposers(state: KernelState, id: string): Promise<void> {
  const disposers = state.disposers.get(id);
  if (!disposers) return;
  for (const d of [...disposers].reverse()) {
    try {
      await d();
    } catch (err) {
      state.rootLog.warn(`disposer de "${id}" lançou`, { err: String(err) });
    }
  }
  state.disposers.delete(id);
}

async function runScope(state: KernelState, id: string): Promise<void> {
  const scope = state.scopes.get(id);
  if (!scope) return;
  try {
    await scope.run();
  } catch (err) {
    state.rootLog.warn(`scope de "${id}" lançou`, { err: String(err) });
  }
  state.scopes.delete(id);
}

function stopTimers(state: KernelState, id: string): void {
  state.schedulers.get(id)?.stop();
  state.clocks.get(id)?.cancelAll();
  state.schedulers.delete(id);
  state.clocks.delete(id);
}

function detachSubsystems(state: KernelState, id: string): void {
  state.events.disposePlugin(id);
  state.dispatcher.disposePlugin(id);
  state.eventRegistry.disposePlugin(id);
  state.commandRegistry.disposePlugin(id);
  state.queryRegistry.disposePlugin(id);
  state.slots.disposePlugin(id);
  state.capabilityWatchers.disposePlugin(id);
  // NEW: rejeita awaits pendentes deste plugin.
  state.capabilityWaiters.disposePlugin(id);
  // NEW: remove tokens que este plugin declarou (core tokens ficam —
  // owner = "kernel").
  state.serviceTokens.disposeOwner(id);
  state.txManager.forget(id);
  state.resolver.forget(id);
}

function notifyCapabilityRemoval(state: KernelState, id: string, notifyUnavailable: boolean): void {
  const entry = state.registry.get(id);
  if (!entry) return;
  for (const p of entry.manifest.capabilities?.provides ?? []) {
    state.capabilityWatchers.notify(p.id, undefined);
    if (notifyUnavailable) state.capabilityWaiters.notifyUnavailable(p.id);
  }
  state.capabilities.detachProvider(id);
}

function cleanupRegistry(state: KernelState, id: string): void {
  state.registry.setState(id, "disposed");
  state.readiness.markReady(id);
  state.abortControllers.delete(id);
  state.configs.delete(id);
  state.pluginStorages.delete(id);
}