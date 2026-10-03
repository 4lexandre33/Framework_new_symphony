// src/core/runtime/stop.ts
import type { KernelState } from "./state";
import { createLogger } from "../internal/logger";
import { withTimeout } from "../internal/ttl";
import { emitLifecycle } from "./lifecycle-events";
import { createContext } from "./context";
import { disposePlugin } from "./dispose";

/**
 * Para o kernel. Ordem reversa do boot. Nunca lança — falhas viram log
 * e status passa a "stopped".
 */
export async function stop(state: KernelState): Promise<void> {
  if (
    state.status !== "running" &&
    state.status !== "booting" &&
    state.status !== "failed"
  ) {
    return;
  }
  state.status = "stopping";
  await emitLifecycle(state, "kernel.stopping", {});

  const ids =
    state.bootOrder.length > 0
      ? [...state.bootOrder].reverse()
      : state.registry.all().map((p) => p.manifest.id).reverse();

  try {
    await withTimeout(
      runStop(state, ids),
      state.stopTimeoutMs,
      () => `stop excedeu ${state.stopTimeoutMs}ms`,
    );
  } catch (err) {
    state.rootLog.error("stop timeout", { err: String(err) });
    state.status = "stopped";
  }
}

async function runStop(state: KernelState, ids: readonly string[]): Promise<void> {
  try {
    await withTimeout(
      state.emitQueue.drain(),
      Math.max(500, Math.floor(state.stopTimeoutMs / 2)),
      () => "drain de emit excedeu",
    );
  } catch (err) {
    state.rootLog.warn("drain falhou", { err: String(err) });
  }
  state.emitQueue.stop();

  await runOnStopHooks(state, ids);
  for (const id of ids) await disposePlugin(state, id, { rebindConsumers: false, force: true });

  state.capabilityWatchers.clear();
  state.bootOrder = [];
  state.status = "stopped";
  await emitLifecycle(state, "kernel.stopped", {});
}

async function runOnStopHooks(
  state: KernelState,
  ids: readonly string[],
): Promise<void> {
  for (const id of ids) {
    const entry = state.registry.get(id);
    const hook = entry?.manifest.lifecycleHooks?.onStop;
    if (!hook) continue;
    try {
      await hook(createContext(state, id, createLogger(id, {})));
    } catch (err) {
      state.rootLog.error(`onStop de "${id}" falhou`, { err: String(err) });
    }
  }
}