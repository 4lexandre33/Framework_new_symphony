import type { KernelState } from "./state";
import type { Plugin } from "../contracts/plugin-context";
import { KernelError } from "../contracts/errors";
import {
  CapabilityRegistry,
  computeBootOrder,
  createLogger,
  createScope,
  createStorageForManifest,
  createSystemClock,
  freezeValue,
  SchedulerImpl,
} from "../internal";
import { register } from "./register";
import { disposePlugin } from "./dispose";
import { createContext } from "./context";
import { emitLifecycle } from "./lifecycle-events";

function preflight(state: KernelState, manifests: readonly import("../contracts/plugin-manifest").PluginManifest[]): void {
  computeBootOrder(manifests);
  const caps = new CapabilityRegistry({
    allowInternalConsumeExternal: state.options.allowInternalConsumeExternal ?? false,
  });
  for (const m of manifests) {
    for (const p of m.capabilities?.provides ?? []) caps.declareProvider(m.id, m.kind, p);
    for (const r of m.capabilities?.consumes ?? []) caps.declareRequirement(m.id, m.kind, r);
  }
  for (const m of manifests) caps.resolveFor(m.id);
}

function prepare(state: KernelState, id: string): void {
  const m = state.registry.mustGet(id).manifest;
  state.scopes.set(id, createScope());
  state.abortControllers.set(id, new AbortController());
  state.schedulers.set(id, new SchedulerImpl());
  state.clocks.set(id, createSystemClock());
  state.pluginStorages.set(id, createStorageForManifest(m));
}

export async function install(state: KernelState, plugin: Plugin): Promise<void> {
  if (state.status !== "running") throw new KernelError("PLUGIN_REGISTERED_AFTER_BOOT", "install exige kernel running");
  if (!state.allowLateRegistration) throw new KernelError("PLUGIN_REGISTERED_AFTER_BOOT", "install exige allowLateRegistration=true");
  const candidate = [...state.registry.all().map((x) => x.manifest), plugin.manifest];
  preflight(state, candidate);

  register(state, plugin);
  const id = plugin.manifest.id;
  try {
    prepare(state, id);
    let cfg: Record<string, unknown> = {};
    const schema = plugin.manifest.configSchema;
    if (schema) {
      const user = state.userConfigs?.[id];
      cfg = schema.parse(user === undefined ? schema.defaults : { ...schema.defaults, ...user });
    }
    state.configs.set(id, freezeValue(cfg));
    state.registry.setState(id, "setup");
    await emitLifecycle(state, "kernel.plugin.setup.start", { pluginId: id });
    await plugin.setup(createContext(state, id, createLogger(id, {})));
    await emitLifecycle(state, "kernel.plugin.setup.done", { pluginId: id });
    state.resolver.resolvePlugin(id);

    const provided = new Set((plugin.manifest.capabilities?.provides ?? []).map((p) => p.id));
    const consumers = state.registry.all()
      .filter((x) => x.manifest.id !== id)
      .filter((x) => (x.manifest.capabilities?.consumes ?? []).some((r) => provided.has(r.id)))
      .map((x) => x.manifest.id);
    state.resolver.rebindAll(consumers);

    await state.readiness.whenReady({ timeoutMs: state.readyTimeoutMs });
    state.registry.setState(id, "started");
    await emitLifecycle(state, "kernel.plugin.started", { pluginId: id });
    await plugin.manifest.lifecycleHooks?.onBoot?.(createContext(state, id, createLogger(id, {})));
    state.bootOrder = computeBootOrder(state.registry.all().map((x) => x.manifest)).map((x) => x.id);
  } catch (err) {
    state.registry.setState(id, "failed", err);
    state.readiness.markFailed(id);
    await disposePlugin(state, id, { rebindConsumers: false, force: true });
    state.registry.unregister(id);
    throw err;
  }
}

export async function uninstall(state: KernelState, id: string): Promise<void> {
  if (state.status !== "running") throw new KernelError("PLUGIN_REGISTERED_AFTER_BOOT", "uninstall exige kernel running");
  const entry = state.registry.get(id);
  if (!entry) throw new KernelError("PLUGIN_MISSING", `plugin "${id}" não encontrado`);
  const candidate = state.registry.all().filter((x) => x.manifest.id !== id).map((x) => x.manifest);
  preflight(state, candidate);
  await disposePlugin(state, id, { force: true });
  state.registry.unregister(id);
  state.bootOrder = computeBootOrder(candidate).map((x) => x.id);
}
