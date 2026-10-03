// src/core/kernel-types.ts
//
// Ponto único para tipos do kernel. Nenhum outro arquivo de core
// re-exporta estes — quem consome importa daqui (ou de `@core`).

export type {
  KernelOptions,
  UserPluginConfigs,
} from "./contracts/kernel-options";
export type {
  KernelState,
  KernelStatus,
  KernelPluginSnapshot,
} from "./contracts/kernel-state";
export type {
  LoggerOptions,
  LogEntry,
  LogLevel,
  Logger,
} from "./contracts/logger";
export type {
  Middleware,
  MiddlewareCtx,
  MiddlewareKind,
} from "./contracts/middleware";
export { KERNEL_API_VERSION } from "./contracts/kernel-version";