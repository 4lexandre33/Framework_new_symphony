// @ai-why:  Substitui plugin em runtime. rollbackReplace RE-EXECUTA setup() do plugin antigo.
// @ai-link: runtime/dispose.ts, runtime/boot.ts
// @ai-keep: rollback não pode deixar kernel sem recursos. Se setup do antigo falhar, o kernel fica degradado — log, não throw.

// src/core/runtime/replace.ts
//
// CHANGED:
//   1. Imports consolidados via `../internal` (barrel).
//   2. `rollbackReplace` RE-EXECUTA `setup()` do plugin antigo, corrigindo
//      a limitação documentada na versão original. Após o rollback, o
//      plugin antigo tem recursos novos (scope, controller, storage) e
//      está operacional.

import type { KernelState } from "./state";
import type { Plugin } from "../contracts/plugin-context";
import type { CapabilityProvision } from "../contracts/capability-token";
import type { PluginKind } from "../contracts/plugin-kind";
import { KernelError } from "../contracts/errors";
import { KERNEL_API_VERSION } from "../contracts/kernel-version";
import {
  satisfies,
  assertManifestShape,
  computeBootOrder,
  CapabilityRegistry,
  createScope,
  createSystemClock,
  SchedulerImpl,
  createLogger,
  freezeValue,
  createStorageForManifest,
} from "../internal";
import type { RegisteredPlugin } from "../internal";
import { emitLifecycle, emitCapabilityChanged } from "./lifecycle-events";
import { createContext, trackDisposer } from "./context";
import { disposePlugin } from "./dispose";

interface ReplaceSnapshot {
  oldEntry: RegisteredPlugin;
  oldValues: ReadonlyMap<string, unknown>;
  oldProvisions: readonly CapabilityProvision[];
  oldKind: PluginKind;
  oldConfig: Readonly<Record<string, unknown>> | undefined;
}

export async function replace(
  state: KernelState,
  id: string,
  newPlugin: Plugin,
): Promise<void> {
  validateReplace(state, id, newPlugin);
  preflightReplace(state, id, newPlugin);
  const snap = captureSnapshot(state, id);

  await disposePlugin(state, id, { rebindConsumers: false, force: true, notifyUnavailable: false });
  state.registry.unregister(id);

  try {
    state.registry.register(newPlugin);
  } catch (err) {
    await rollbackReplace(state, id, snap);
    throw err;
  }

  declareNewProvides(state, id, newPlugin);
  prepareResources(state, id);

  const config = tryParseConfig(state, id, newPlugin);
  if (config === null) {
    await rollbackReplace(state, id, snap);
    throw new KernelError("CONFIG_INVALID", `config inválida para "${id}"`);
  }
  state.configs.set(id, freezeValue(config));

  const setupErr = await runSetup(state, id, newPlugin);
  if (setupErr) {
    await rollbackReplace(state, id, snap);
    throw setupErr;
  }

  try {
    state.resolver.resolvePlugin(id);
  } catch (err) {
    state.registry.setState(id, "failed", err);
    await emitLifecycle(state, "kernel.plugin.resolve.failed", {
      pluginId: id,
      error: String(err),
    });
    await rollbackReplace(state, id, snap);
    throw err;
  }

  rebindConsumers(state, id, snap.oldProvisions);

  const readyErr = await waitReady(state, id);
  if (readyErr) {
    // replace é atômico: tolerant permite a PLATAFORMA continuar, não
    // promove um plugin que falhou em readiness.
    await rollbackReplace(state, id, snap);
    throw readyErr;
  }

  state.registry.setState(id, "started");
  await emitLifecycle(state, "kernel.plugin.started", { pluginId: id });
  const onBootErr = await runOnBoot(state, id, newPlugin);
  if (onBootErr) {
    await rollbackReplace(state, id, snap);
    throw onBootErr;
  }

  recomputeBootOrder(state);
  await emitCapabilityDiff(state, id, snap);

  await emitLifecycle(state, "kernel.plugin.replaced", {
    pluginId: id,
    oldVersion: snap.oldEntry.manifest.version,
    newVersion: newPlugin.manifest.version,
  });
}

function validateReplace(state: KernelState, id: string, p: Plugin): void {
  if (p.manifest.id !== id) {
    throw new KernelError(
      "PLUGIN_MISSING",
      `replace("${id}") exige manifest.id === "${id}"`,
      { expectedId: id, receivedId: p.manifest.id },
    );
  }
  if (state.status !== "running") {
    throw new KernelError(
      "PLUGIN_REGISTERED_AFTER_BOOT",
      `replace exige kernel running, atual "${state.status}"`,
      { pluginId: id, status: state.status },
    );
  }
  if (!state.registry.get(id)) {
    throw new KernelError("PLUGIN_MISSING", `plugin "${id}" não registrado`);
  }
  if (!state.bootOrder.includes(id)) {
    throw new KernelError(
      "PLUGIN_MISSING",
      `plugin "${id}" não estava no boot order`,
    );
  }
  assertManifestShape(p.manifest);

  const old = state.registry.mustGet(id).manifest;
  if (old.kind !== p.manifest.kind) {
    throw new KernelError(
      "PLUGIN_KIND_MISMATCH",
      `replace("${id}") não pode trocar kind (${old.kind} → ${p.manifest.kind})`,
      { pluginId: id, fromKind: old.kind, toKind: p.manifest.kind },
    );
  }
  if (p.manifest.kind === "external") {
    throw new KernelError(
      "PLUGIN_KIND_MISMATCH",
      `replace("${id}") de external deve passar pelo plugin-host`,
      { pluginId: id, kind: "external" },
    );
  }
  if (p.manifest.api && !satisfies(KERNEL_API_VERSION, p.manifest.api)) {
    throw new KernelError(
      "PLUGIN_API_MISMATCH",
      `plugin "${id}" requer api "${p.manifest.api}"`,
    );
  }
}

/** Validação sem efeitos colaterais: o provider antigo ainda está ativo. */
function preflightReplace(state: KernelState, id: string, p: Plugin): void {
  const manifests = state.registry.all().map((entry) =>
    entry.manifest.id === id ? p.manifest : entry.manifest,
  );
  computeBootOrder(manifests);

  const caps = new CapabilityRegistry({
    allowInternalConsumeExternal: state.options.allowInternalConsumeExternal ?? false,
  });
  for (const manifest of manifests) {
    for (const prov of manifest.capabilities?.provides ?? []) {
      caps.declareProvider(manifest.id, manifest.kind, prov);
    }
    for (const req of manifest.capabilities?.consumes ?? []) {
      caps.declareRequirement(manifest.id, manifest.kind, req);
    }
  }
  for (const manifest of manifests) caps.resolveFor(manifest.id);
}

function captureSnapshot(state: KernelState, id: string): ReplaceSnapshot {
  const oldEntry = state.registry.mustGet(id);
  return {
    oldEntry,
    oldValues: state.capabilities.snapshotValues(id),
    oldProvisions: oldEntry.manifest.capabilities?.provides ?? [],
    oldKind: oldEntry.manifest.kind,
    oldConfig: state.configs.get(id),
  };
}

function declareNewProvides(state: KernelState, id: string, p: Plugin): void {
  const kind = p.manifest.kind;
  for (const prov of p.manifest.capabilities?.provides ?? []) {
    state.capabilities.declareProvider(id, kind, prov);
  }
  for (const req of p.manifest.capabilities?.consumes ?? []) {
    state.capabilities.declareRequirement(id, kind, req);
  }
  for (const slot of p.manifest.definesSlots ?? []) {
    const dispose = state.slots.define({ ...slot, owner: id });
    trackDisposer(state, id, dispose);
  }
}

function prepareResources(state: KernelState, id: string): void {
  const manifest = state.registry.mustGet(id).manifest;
  state.scopes.set(id, createScope());
  state.abortControllers.set(id, new AbortController());
  state.schedulers.set(id, new SchedulerImpl());
  state.clocks.set(id, createSystemClock());
  state.pluginStorages.set(id, createStorageForManifest(manifest));
  state.readiness.markPending(id);
}

function tryParseConfig(
  state: KernelState,
  id: string,
  p: Plugin,
): Record<string, unknown> | null {
  try {
    const schema = p.manifest.configSchema;
    if (!schema) return {};
    const userConfig = state.userConfigs?.[id];
    const raw =
      userConfig !== undefined
        ? { ...schema.defaults, ...(userConfig as Record<string, unknown>) }
        : schema.defaults;
    return schema.parse(raw);
  } catch {
    return null;
  }
}

async function runSetup(
  state: KernelState,
  id: string,
  p: Plugin,
): Promise<Error | null> {
  const log = createLogger(id, {});
  try {
    state.registry.setState(id, "setup");
    await emitLifecycle(state, "kernel.plugin.setup.start", { pluginId: id });
    await p.setup(createContext(state, id, log));
    await emitLifecycle(state, "kernel.plugin.setup.done", { pluginId: id });
    return null;
  } catch (err) {
    state.registry.setState(id, "failed", err);
    log.error("replace setup falhou", { err: String(err) });
    await emitLifecycle(state, "kernel.plugin.setup.failed", {
      pluginId: id,
      error: String(err),
    });
    return err as Error;
  }
}

/**
 * Re-resolve consumidores cujas capabilities são afetadas por um replace.
 *
 * @ai-why: A versão anterior comparava `c.id === id` onde `id` era o id do
 * plugin substituído — nunca casava (namespaces diferentes). Agora computa
 * a UNIÃO das provides antigas e novas e rebinda quem consome qualquer
 * uma delas.
 * @ai-keep: `oldProvisions` vem do snapshot capturado ANTES do dispose.
 */
function rebindConsumers(
  state: KernelState,
  id: string,
  oldProvisions: readonly CapabilityProvision[],
): void {
  const newEntry = state.registry.get(id);
  const newProvisions = newEntry?.manifest.capabilities?.provides ?? [];
  const affected = new Set<string>([
    ...oldProvisions.map((p) => p.id),
    ...newProvisions.map((p) => p.id),
  ]);
  if (affected.size === 0) return;

  const consumers: string[] = [];
  for (const plugin of state.registry.all()) {
    if (plugin.manifest.id === id) continue;
    const cs = plugin.manifest.capabilities?.consumes ?? [];
    if (cs.some((c) => affected.has(c.id))) consumers.push(plugin.manifest.id);
  }
  if (consumers.length === 0) return;

  state.resolver.rebindAll(consumers, (consumerId, err) => {
    state.rootLog.warn(`rebind de "${consumerId}" falhou`, {
      err: String(err),
    });
    state.registry.setState(consumerId, "failed", err);
  });
}

async function waitReady(
  state: KernelState,
  id: string,
): Promise<Error | null> {
  try {
    await state.readiness.whenReady({ timeoutMs: state.readyTimeoutMs });
    return null;
  } catch (err) {
    const isTimeout =
      err instanceof KernelError &&
      (err.code === "TIMEOUT" || err.code === "READY_TIMEOUT");
    if (!isTimeout) return err as Error;
    state.rootLog.warn(`readiness timeout após replace de "${id}"`);
    state.registry.setState(id, "failed", err);
    await emitLifecycle(state, "kernel.plugin.ready.timeout", { pluginId: id });
    return err as Error;
  }
}

async function runOnBoot(
  state: KernelState,
  id: string,
  p: Plugin,
): Promise<Error | null> {
  const hook = p.manifest.lifecycleHooks?.onBoot;
  if (!hook) return null;
  try {
    await hook(createContext(state, id, createLogger(id, {})));
    return null;
  } catch (err) {
    state.rootLog.error(`onBoot de "${id}" falhou`, { err: String(err) });
    return err as Error;
  }
}

function recomputeBootOrder(state: KernelState): void {
  const manifests = state.registry.all().map((p) => p.manifest);
  state.bootOrder = computeBootOrder(manifests).map((m) => m.id);
}

async function emitCapabilityDiff(
  state: KernelState,
  id: string,
  snap: ReplaceSnapshot,
): Promise<void> {
  const newValues = state.capabilities.snapshotValues(id);
  const diff = state.capabilities.diffSnapshots(snap.oldValues, newValues);
  for (const capId of diff.provided) {
    await emitCapabilityChanged(state, capId, id, "provided");
  }
  for (const capId of diff.replaced) {
    await emitCapabilityChanged(state, capId, id, "replaced");
  }
  for (const capId of diff.removed) {
    await emitCapabilityChanged(state, capId, id, "removed");
    state.capabilityWatchers.notify(capId, undefined);
    state.capabilityWaiters.notifyUnavailable(capId);
  }
}

/**
 * Rollback de `replace`.
 *
 * CORRIGIDO vs. versão anterior: re-registra o manifest antigo,
 * restaura os valores de capabilities E RE-EXECUTA `setup()` do plugin
 * antigo. Após isto, o plugin antigo está operacional — tem scope,
 * controller, storage, schedulers, clocks novos. Um caller que precise
 * invocar `createContext(id)` após o rollback não encontra mais o
 * estado "sem recursos".
 */
async function rollbackReplace(
  state: KernelState,
  id: string,
  snap: ReplaceSnapshot,
): Promise<void> {
  try {
    await disposePlugin(state, id, { force: true });
    state.registry.unregister(id);
    state.registry.register(snap.oldEntry.plugin);

    // Redeclara provides do plugin antigo (o dispose limpou).
    state.capabilities.restoreValues(
      id,
      snap.oldKind,
      snap.oldProvisions,
      snap.oldValues,
    );
    // O dispose remove requirements e descriptors. Rollback precisa
    // reconstruir TODO o contrato do manifest antigo, não só provides.
    for (const req of snap.oldEntry.manifest.capabilities?.consumes ?? []) {
      state.capabilities.declareRequirement(id, snap.oldKind, req);
    }
    for (const slot of snap.oldEntry.manifest.definesSlots ?? []) {
      const dispose = state.slots.define({ ...slot, owner: id });
      trackDisposer(state, id, dispose);
    }
    if (snap.oldConfig !== undefined) {
      state.configs.set(id, snap.oldConfig);
    }

    // Recurso por plugin — precisam ser recriados antes de setup.
    prepareResources(state, id);

    // NEW: re-executa `setup` do plugin antigo. Sem isto, `createContext`
    // lançaria por falta de scope/controller/storage.
    const setupErr = await runSetup(state, id, snap.oldEntry.plugin);
    if (setupErr) {
      state.rootLog.error(
        `rollback de "${id}": setup do plugin antigo falhou — kernel em estado degradado`,
        { err: String(setupErr) },
      );
      return;
    }
    try {
      state.resolver.resolvePlugin(id);
      rebindConsumers(state, id, snap.oldProvisions);
      state.readiness.markReady(id);
    } catch (err) {
      state.rootLog.warn(`rollback de "${id}": rebind falhou`, {
        err: String(err),
      });
    }
  } catch (err) {
    state.rootLog.error(`rollback de "${id}" falhou`, { err: String(err) });
  }
}