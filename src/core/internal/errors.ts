// src/core/internal/errors.ts
import {
  KernelError,
  PluginError,
  type KernelErrorCode,
} from "../contracts/errors";

export { KernelError, PluginError };
export type { KernelErrorCode };

// CHANGED: removido o union `ExtendedKernelErrorCode`. Ele era um
// superset que duplicava códigos já presentes em `KernelErrorCode` e
// forçava um cast inseguro (`code as KernelErrorCode`) em `make`. Se
// algum código novo for preciso, ele entra em `contracts/errors.ts` —
// fonte única — e este arquivo segue referenciando só `KernelErrorCode`.

function make(
  code: KernelErrorCode,
  message: string,
  detail?: Record<string, unknown>,
): KernelError {
  return new KernelError(code, message, detail);
}

export const kernelErrors = {
  slotDuplicate: (slotId: string, owner: string): KernelError =>
    make("SLOT_DUPLICATE", `slot "${slotId}" já definido por "${owner}"`, {
      slotId,
      owner,
    }),

  configInvalid: (pluginId: string, message: string): KernelError =>
    make("CONFIG_INVALID", `config inválida em "${pluginId}": ${message}`, {
      pluginId,
    }),

  bootTimeout: (ms: number, pending: readonly string[]): KernelError =>
    make(
      "BOOT_TIMEOUT",
      pending.length
        ? `boot excedeu ${ms}ms; pendentes: [${pending.join(", ")}]`
        : `boot excedeu ${ms}ms`,
      { ms, pending },
    ),

  readyTimeout: (ms: number, pending: readonly string[]): KernelError =>
    make(
      "READY_TIMEOUT",
      `readiness excedeu ${ms}ms; pendentes: [${pending.join(", ")}]`,
      { ms, pending },
    ),

  capabilityTimeout: (
    pluginId: string,
    capabilityId: string,
    ms: number,
  ): KernelError =>
    make(
      "CAPABILITY_TIMEOUT",
      `plugin "${pluginId}" aguardou capability "${capabilityId}" por ${ms}ms sem provide`,
      { pluginId, capabilityId, ms },
    ),

  pluginRegisteredAfterBoot: (pluginId: string): KernelError =>
    make(
      "PLUGIN_REGISTERED_AFTER_BOOT",
      `register("${pluginId}") após boot é rejeitado (allowLateRegistration=false)`,
      { pluginId },
    ),

  pluginHasDependents: (
    pluginId: string,
    dependents: readonly string[],
  ): KernelError =>
    make(
      "PLUGIN_HAS_DEPENDENTS",
      `não é possível remover "${pluginId}"; dependentes: [${dependents.join(", ")}]`,
      { pluginId, dependents },
    ),

  transactionNested: (pluginId: string): KernelError =>
    make(
      "TRANSACTION_NESTED",
      `plugin "${pluginId}" já está em uma transação; transações não são aninháveis`,
      { pluginId },
    ),

  transactionClosed: (txId: string): KernelError =>
    make("TRANSACTION_CLOSED", `transação "${txId}" já foi fechada`, { txId }),
};