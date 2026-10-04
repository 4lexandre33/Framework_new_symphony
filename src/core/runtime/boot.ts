// src/core/runtime/boot.ts
//
// CHANGED: imports consolidados via `../internal` (barrel). Nenhuma
// mudança de comportamento.

import type { KernelState } from "./state";
import type { PluginManifest } from "../contracts/plugin-manifest";
import { KernelError } from "../contracts/errors";
import {
  runArchitecturalPreflight,
  createScope,
  createSystemClock,
  SchedulerImpl,
  createLogger,
  freezeValue,
  withTimeout,
  createStorageForManifest,
} from "../internal";
import { emitLifecycle } from "./lifecycle-events";
import { createContext } from "./context";

export async function boot(state: KernelState): Promise<void> {
  if (state.status !== "idle") {
    throw new KernelError(
      "PLUGIN_MISSING",
      `kernel já está em "${state.status}"`,
    );
  }
  state.status = "booting";

  try {
    await withTimeout(
      runBoot(state),
      state.bootTimeoutMs,
      () => {
        const pending = state.readiness.pendingList();
        return pending.length
          ? `boot excedeu ${state.bootTimeoutMs}ms; pendentes: [${pending.join(", ")}]`
          : `boot excedeu ${state.bootTimeoutMs}ms`;
      },
      "BOOT_TIMEOUT",
    );
  } catch (err) {
    state.status = "failed";
    throw err;
  }
}

async function runBoot(state: KernelState): Promise<void> {
  const manifests = state.registry.all().map((p) => p.manifest);
  const order = runArchitecturalPreflight(manifests, {
    allowInternalConsumeExternal:
      state.options.allowInternalConsumeExternal ?? false,
  });
  state.bootOrder = order.map((m) => m.id);

  state.phase = "setup";
  for (const manifest of order) await setupOne(state, manifest);
  state.phase = "resolving";
  await resolveAll(state, order);
  state.phase = "ready";
  await waitReady(state);
  await markStarted(state, order);

  state.phase = "running";
  state.status = "running";
  await emitLifecycle(state, "kernel.booted", {
    plugins: order.map((m) => m.id),
    order: state.bootOrder,
  });
}

async function setupOne(
  state: KernelState,
  manifest: PluginManifest,
): Promise<void> {
  const entry = state.registry.mustGet(manifest.id);
  const log = createLogger(manifest.id, {});
  state.scopes.set(manifest.id, createScope());
  state.abortControllers.set(manifest.id, new AbortController());
  state.schedulers.set(manifest.id, new SchedulerImpl());
  state.clocks.set(manifest.id, createSystemClock());
  state.pluginStorages.set(
    manifest.id,
    createStorageForManifest(manifest),
  );

  let config: Record<string, unknown> = {};
  try {
    const schema = manifest.configSchema;
    if (schema) {
      const userConfig = state.userConfigs?.[manifest.id];
      const raw =
        userConfig !== undefined
          ? { ...schema.defaults, ...(userConfig as Record<string, unknown>) }
          : schema.defaults;
      config = schema.parse(raw);
    }
  } catch (err) {
    log.error("config inválida", { err: String(err) });
    state.registry.setState(manifest.id, "failed", err);
    state.readiness.markFailed(manifest.id);
    await emitLifecycle(state, "kernel.plugin.config.failed", {
      pluginId: manifest.id,
      error: String(err),
    });
    if (!state.tolerant) throw err;
    return;
  }
  state.configs.set(manifest.id, freezeValue(config));

  const ctx = createContext(state, manifest.id, log);
  try {
    state.registry.setState(manifest.id, "setup");
    await emitLifecycle(state, "kernel.plugin.setup.start", {
      pluginId: manifest.id,
    });
    await entry.plugin.setup(ctx);
    await emitLifecycle(state, "kernel.plugin.setup.done", {
      pluginId: manifest.id,
    });
  } catch (err) {
    state.registry.setState(manifest.id, "failed", err);
    state.readiness.markFailed(manifest.id);
    log.error("setup falhou", { err: String(err) });
    await emitLifecycle(state, "kernel.plugin.setup.failed", {
      pluginId: manifest.id,
      error: String(err),
    });
    if (!state.tolerant) throw err;
  }
}

async function resolveAll(
  state: KernelState,
  order: readonly PluginManifest[],
): Promise<void> {
  for (const manifest of order) {
    if (state.registry.mustGet(manifest.id).state === "failed") continue;
    try {
      state.resolver.resolvePlugin(manifest.id);
    } catch (err) {
      state.registry.setState(manifest.id, "failed", err);
      state.readiness.markFailed(manifest.id);
      await emitLifecycle(state, "kernel.plugin.resolve.failed", {
        pluginId: manifest.id,
        error: String(err),
      });
      if (!state.tolerant) throw err;
    }
  }
}

async function waitReady(state: KernelState): Promise<void> {
  try {
    await state.readiness.whenReady({ timeoutMs: state.readyTimeoutMs });
  } catch (err) {
    const isTimeout =
      err instanceof KernelError &&
      (err.code === "TIMEOUT" || err.code === "READY_TIMEOUT");
    if (!isTimeout) throw err;
    const pending = state.readiness.pendingList();
    state.rootLog.warn("readiness timeout", { pending });
    for (const id of pending) {
      state.registry.setState(id, "failed", err);
      state.readiness.markFailed(id);
      await emitLifecycle(state, "kernel.plugin.ready.timeout", {
        pluginId: id,
      });
    }
    if (!state.tolerant) throw err;
  }
}

async function markStarted(
  state: KernelState,
  order: readonly PluginManifest[],
): Promise<void> {
  for (const manifest of order) {
    const entry = state.registry.mustGet(manifest.id);
    if (entry.state === "failed") continue;
    state.registry.setState(manifest.id, "started");
    await emitLifecycle(state, "kernel.plugin.started", {
      pluginId: manifest.id,
    });

    const hook = manifest.lifecycleHooks?.onBoot;
    if (hook) {
      try {
        await hook(
          createContext(state, manifest.id, createLogger(manifest.id, {})),
        );
      } catch (err) {
        state.rootLog.error(`onBoot de "${manifest.id}" falhou`, {
          err: String(err),
        });
        if (!state.tolerant) throw err;
      }
    }
  }
}