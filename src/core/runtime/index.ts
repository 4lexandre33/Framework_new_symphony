// src/core/runtime/index.ts
//
// Barrel do runtime. `kernel.ts` importa daqui — nunca de
// `./runtime/boot`, `./runtime/state`, etc. `runtime/*.ts` continua
// importando seus irmãos diretamente (`./boot`), que não é sub-path
// e portanto não dispara a regra ESLint.

export { KernelState, createKernelState } from "./state";

export { register } from "./register";
export { boot } from "./boot";
export { stop } from "./stop";
export { replace } from "./replace";
export { install, uninstall } from "./install";
export { disposePlugin } from "./dispose";
export { snapshot } from "./snapshot";

export { createContext, trackDisposer } from "./context";

export { createTestHooks } from "./test-hooks";
export type { TestHooks } from "./test-hooks";

export { emitLifecycle, emitCapabilityChanged } from "./lifecycle-events";

export { makeCapsApi } from "./caps";
export { createServiceApi } from "./services";

export {
  buildEventEnvelope,
  buildCommandEnvelope,
  buildQueryEnvelope,
  emitThroughPipeline,
  sendThroughPipeline,
  askThroughPipeline,
  dispatchCapabilityThroughPipeline,
} from "./pipeline";

export {
  assertCanEmit,
  assertCanUseCapability,
  canEmit,
  canUseCapability,
} from "./permissions";