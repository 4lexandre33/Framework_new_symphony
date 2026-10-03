// @ai-why:  Constrói o PluginContext. Cada chamada lê state.* e monta as 8 sub-APIs.
// @ai-link: contracts/plugin-context.ts
// @ai-keep: toda sub-API precisa vir de state existente. createContext lança se scope/controller/storage faltar.

// src/core/runtime/context.ts
//
// CHANGED: injeta `services` (ServiceApi) no PluginContext.

import type { KernelState } from "./state";
import type {
  PluginContext,
  EnvApi,
  LifecycleApi,
  EventBusApi,
  CommandApi,
  QueryApi,
  SlotApi,
  Logger,
  CapabilityAwaitOptions,
  LifecycleWhenReadyOptions,
} from "../contracts/plugin-context";
import type { TransactionApi } from "../contracts/transaction";
import type { EnvelopeApi, DispatchEnvelope } from "../contracts/dispatch-envelope";
import { KernelError } from "../contracts/errors";
import { createSystemClock, SchedulerImpl } from "../internal";
import {
  buildEventEnvelope,
  buildCommandEnvelope,
  buildQueryEnvelope,
  emitThroughPipeline,
  sendThroughPipeline,
  askThroughPipeline,
  dispatchCapabilityThroughPipeline,
} from "./pipeline";
import { makeCapsApi } from "./caps";
import { createServiceApi } from "./services";
import { assertCanEmit, assertCanUseCapability } from "./permissions";

export function createContext(
  state: KernelState,
  pluginId: string,
  log: Logger,
): PluginContext {
  const controller = state.abortControllers.get(pluginId);
  const scope = state.scopes.get(pluginId);
  const storage = state.pluginStorages.get(pluginId);

  if (!controller) {
    throw new KernelError(
      "PLUGIN_MISSING",
      `createContext("${pluginId}") chamado antes de preparar o AbortController`,
      { pluginId },
    );
  }
  if (!scope) {
    throw new KernelError(
      "PLUGIN_MISSING",
      `createContext("${pluginId}") chamado antes de preparar o ResourceScope`,
      { pluginId },
    );
  }
  if (!storage) {
    throw new KernelError(
      "PLUGIN_MISSING",
      `createContext("${pluginId}") chamado antes de preparar o PluginStorage`,
      { pluginId },
    );
  }

  const signal = controller.signal;
  const manifest = state.registry.mustGet(pluginId).manifest;
  const config = state.configs.get(pluginId) ?? {};
  const clock = state.clocks.get(pluginId) ?? createSystemClock();
  const scheduler = state.schedulers.get(pluginId) ?? new SchedulerImpl();

  const env: EnvApi = {
    get: (key) => state.envSource[key],
    has: (key) => key in state.envSource,
    require: (key) => {
      const value = state.envSource[key];
      if (value === undefined) {
        throw new KernelError(
          "CONFIG_INVALID",
          `env "${key}" ausente (plugin "${pluginId}")`,
          { pluginId, key },
        );
      }
      return value;
    },
  };

  const events: EventBusApi = {
    emit: (type, payload) => {
      assertCanEmit(manifest, type);
      state.emitQueue.push(buildEventEnvelope(state, type, payload, pluginId));
    },
    emitAsync: (type, payload) => {
      assertCanEmit(manifest, type);
      return emitThroughPipeline(
        state,
        buildEventEnvelope(state, type, payload, pluginId),
      );
    },
    on: (type, handler) => state.events.on(pluginId, type, handler),
    onAny: (handler) => state.events.onAny(pluginId, handler),
    define: (def) => state.eventRegistry.define(pluginId, def),
  };

  const commands: CommandApi = {
    send: (type, payload) =>
      sendThroughPipeline(
        state,
        buildCommandEnvelope(state, type, payload, pluginId),
        signal,
      ),
    handle: (type, handler) =>
      state.dispatcher.handleCommand(type, pluginId, handler),
    define: (def) => state.commandRegistry.define(pluginId, def),
  };

  const queries: QueryApi = {
    ask: <T extends string, P, R>(
      type: T,
      payload: P,
      opts?: { fallback?: R },
    ) =>
      askThroughPipeline<R>(
        state,
        buildQueryEnvelope(state, type, payload, pluginId),
        signal,
        opts?.fallback,
      ),
    answer: (type, handler) =>
      state.dispatcher.answerQuery(type, pluginId, handler),
    define: (def) => state.queryRegistry.define(pluginId, def),
  };

  const caps = makeCapsApi(state, pluginId);
  // NEW: Service Locator.
  const services = createServiceApi(state, pluginId);

  const slots: SlotApi = {
    contribute: (slotId, value, order) => {
      if (state.enforceSlotContributions) {
        const declared = manifest.contributesTo ?? [];
        if (!declared.some((c) => c.slot === slotId)) {
          throw new KernelError(
            "SLOT_UNKNOWN",
            `plugin "${pluginId}" não declarou contributesTo para "${slotId}"`,
            { pluginId, slotId, declared: declared.map((c) => c.slot) },
          );
        }
      }
      return state.slots.contribute(slotId, pluginId, value, order);
    },
    read: (slotId) => state.slots.read(slotId),
    watch: (slotId, cb) => state.slots.watch(slotId, pluginId, cb),
  };

  const tx: TransactionApi = {
    begin: (label) => state.txManager.begin(pluginId, label),
    current: () => state.txManager.current(pluginId),
    with: (label, fn) => state.txManager.with(pluginId, label, fn),
  };

  const lifecycle: LifecycleApi = {
    onDispose: (fn) => trackDisposer(state, pluginId, fn),
    ready: () => state.readiness.markReady(pluginId),
    whenReady: (opts: LifecycleWhenReadyOptions = {}) =>
      state.readiness.whenReady(opts),
    scope,
    fork: () => scope.fork(),
  };

  const envelope: EnvelopeApi = {
    registerHandler: (handler) => {
      // Registro respeita permissões de capability.
      assertCanUseCapability(manifest, handler.capability);
      return state.envelopeDispatcher.register({ ...handler, provider: pluginId });
    },
    dispatch: <T = unknown>(env: DispatchEnvelope) =>
      dispatchCapabilityThroughPipeline<T>(state, pluginId, env),
  };

  return {
    id: pluginId,
    log,
    clock,
    config,
    env,
    events,
    commands,
    queries,
    caps,
    services,
    slots,
    scheduler,
    tx,
    lifecycle,
    storage,
    envelope,
  };
}

export function trackDisposer(
  state: KernelState,
  pluginId: string,
  fn: () => void | Promise<void>,
): void {
  const list = state.disposers.get(pluginId) ?? [];
  list.push(fn);
  state.disposers.set(pluginId, list);
}

export type { CapabilityAwaitOptions };