export type StorageInfrastructureErrorCode =
  | "unavailable"
  | "permission-denied"
  | "quota-exceeded"
  | "corrupted"
  | "operation-failed";

export type StorageInfrastructureOperation =
  | "save"
  | "load"
  | "list"
  | "delete"
  | "profile-sync"
  | "profile-fetch"
  | "dispose";

export class StorageInfrastructureError
  extends Error {
  public readonly name =
    "StorageInfrastructureError";

  public readonly code:
    StorageInfrastructureErrorCode;

  public readonly operation:
    StorageInfrastructureOperation;

  public readonly recoverable:
    boolean;

  public readonly originalError:
    unknown;

  public constructor(
    code:
      StorageInfrastructureErrorCode,
    operation:
      StorageInfrastructureOperation,
    message: string,
    recoverable: boolean,
    originalError: unknown =
      null,
  ) {
    super(message);

    this.code =
      code;

    this.operation =
      operation;

    this.recoverable =
      recoverable;

    this.originalError =
      originalError;
  }
}

function readErrorName(
  error: unknown,
): string {
  if (
    typeof error ===
      "object" &&
    error !==
      null &&
    "name" in error &&
    typeof (
      error as {
        readonly name?: unknown;
      }
    ).name ===
      "string"
  ) {
    return (
      error as {
        readonly name: string;
      }
    ).name;
  }

  return "";
}

export function normalizeStorageError(
  error: unknown,
  operation:
    StorageInfrastructureOperation,
  fallbackMessage: string,
): StorageInfrastructureError {
  if (
    error instanceof
      StorageInfrastructureError
  ) {
    return error;
  }

  const name =
    readErrorName(
      error,
    );

  if (
    name ===
      "QuotaExceededError" ||
    name ===
      "NS_ERROR_DOM_QUOTA_REACHED"
  ) {
    return new StorageInfrastructureError(
      "quota-exceeded",
      operation,
      fallbackMessage,
      true,
      error,
    );
  }

  if (
    name ===
      "SecurityError" ||
    name ===
      "NotAllowedError"
  ) {
    return new StorageInfrastructureError(
      "permission-denied",
      operation,
      fallbackMessage,
      true,
      error,
    );
  }

  return new StorageInfrastructureError(
    "operation-failed",
    operation,
    fallbackMessage,
    true,
    error,
  );
}
