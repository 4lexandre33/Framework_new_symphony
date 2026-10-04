export type KernelErrorCode =
  | "PLUGIN_DUPLICATE"
  | "PLUGIN_MISSING"
  | "PLUGIN_CYCLE"
  | "PLUGIN_API_MISMATCH"
  | "PLUGIN_THREW"
  | "PLUGIN_REGISTERED_AFTER_BOOT"
  | "PLUGIN_HAS_DEPENDENTS"
  | "PLUGIN_KIND_MISMATCH"
  | "CAPABILITY_MISSING"
  | "CAPABILITY_AMBIGUOUS"
  | "CAPABILITY_VERSION_MISMATCH"
  | "CAPABILITY_CONFLICT"
  | "CAPABILITY_TIMEOUT"
  | "CAPABILITY_SCHEMA_INVALID"
  | "PERMISSION_DENIED"
  | "SLOT_UNKNOWN"
  | "SLOT_DUPLICATE"
  | "DISPATCH_NO_HANDLER"
  | "DISPATCH_MULTIPLE_HANDLERS"
  | "CONFIG_INVALID"
  | "BOOT_TIMEOUT"
  | "READY_TIMEOUT"
  | "TIMEOUT"
  | "TRANSACTION_NESTED"
  | "TRANSACTION_CLOSED"
  | "REGISTRY_DUPLICATE"
  | "REGISTRY_OWNER_MISMATCH"
  | "ENVELOPE_INVALID";

export class KernelError extends Error {
  readonly code: KernelErrorCode;
  readonly detail?: Record<string, unknown>;

  public constructor(
    code: KernelErrorCode,
    message: string,
    detail?: Record<string, unknown>,
  ) {
    super(message);

    this.name = "KernelError";
    this.code = code;
    this.detail = detail;
  }
}

export class PluginError extends Error {
  readonly pluginId: string;
  readonly cause?: unknown;

  public constructor(
    pluginId: string,
    message: string,
    cause?: unknown,
  ) {
    super(`[${pluginId}] ${message}`);

    this.name = "PluginError";
    this.pluginId = pluginId;
    this.cause = cause;
  }
}

export function isKernelError(
  error: unknown,
): error is KernelError {
  return error instanceof KernelError;
}

export function isTimeoutError(
  error: unknown,
): error is KernelError {
  return (
    error instanceof KernelError &&
    (
      error.code === "TIMEOUT" ||
      error.code === "BOOT_TIMEOUT" ||
      error.code === "READY_TIMEOUT" ||
      error.code === "CAPABILITY_TIMEOUT"
    )
  );
}