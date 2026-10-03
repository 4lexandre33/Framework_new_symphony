// src/core/internal/index.ts
//
// Barrel dos internals. `runtime/*` e `kernel.ts` importam daqui —
// nunca de um sub-path (`../internal/foo`). Se um arquivo se move
// dentro deste diretório, só este barrel muda.

export {
  PluginRegistry,
  assertManifestShape,
} from "./plugin-registry";
export type { RegisteredPlugin } from "./plugin-registry";

export { CapabilityRegistry } from "./capability-registry";
export type {
  Binding,
  SnapshotDiff,
  CapabilityRegistryOptions,
} from "./capability-registry";

export { Resolver } from "./resolver";
export type { BindingState } from "./resolver";

export { SlotRegistry } from "./slot-registry";

export { MiddlewareChain } from "./middleware";
export type { Middleware, MiddlewareCtx, MiddlewareKind } from "../contracts/middleware";

export { EventBus } from "./event-bus";
export type { EventBusOptions } from "./event-bus";

export { Dispatcher } from "./dispatcher";
export type { DispatcherOptions } from "./dispatcher";

export { EnvelopeDispatcher } from "./envelope-dispatcher";

export { TransactionManager, TransactionImpl } from "./transaction";

export { ReadinessGate } from "./readiness";
export type { WhenReadyOptions } from "./readiness";

export { CapabilityWatchers } from "./capability-watchers";
export type { CapabilityWatcher } from "./capability-watchers";

export { CapabilityWaiters } from "./capability-waiters";

export { ServiceTokenRegistry, isCapabilityToken } from "./service-token-registry";

export { EmitQueue } from "./emit-queue";
export type { EmitQueueOptions } from "./emit-queue";

export { createLogger } from "./logger";

export { freezeEnvelope, freezeValue } from "./freeze";

export { createScope } from "./scope";
export type { ResourceScope } from "./scope";

export { createSystemClock, createManualClock } from "./clock";
export type { SystemClock, ManualClock } from "./clock";

export { SchedulerImpl } from "./scheduler";
export type { SchedulerEvent, SchedulerOptions } from "./scheduler";

export { computeBootOrder } from "./boot-order";

export { withTimeout } from "./ttl";

export { guardAsync } from "./error-boundary";
export type { GuardOptions } from "./error-boundary";

export {
  createStorageForManifest,
  createPluginStorage,
  createReadOnlyStorage,
  createNoopStorage,
} from "./plugin-storage";

export { kernelErrors } from "./errors";

export { newId } from "./ids";

export { satisfies } from "./semver";