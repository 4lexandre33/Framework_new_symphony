export interface VersionedSnapshot<
  TState,
> {
  readonly schemaVersion: number;
  readonly createdAtEpochMs: number;
  readonly state: TState;
}

function assertSchemaVersion(
  schemaVersion: number,
): void {
  if (
    !Number.isSafeInteger(
      schemaVersion,
    ) ||
    schemaVersion < 1
  ) {
    throw new RangeError(
      "schemaVersion deve ser um inteiro seguro maior ou igual a 1.",
    );
  }
}

function assertEpochMs(
  epochMs: number,
): void {
  if (
    !Number.isSafeInteger(epochMs) ||
    epochMs < 0
  ) {
    throw new RangeError(
      "createdAtEpochMs deve ser um inteiro seguro maior ou igual a 0.",
    );
  }
}

/**
 * Envelope serializável e independente de infraestrutura.
 *
 * A função não consulta relógio, filesystem, Tauri ou engine. O timestamp é
 * fornecido pelo chamador, normalmente através de ClockPort na camada acima.
 */
export function createVersionedSnapshot<
  TState,
>(
  schemaVersion: number,
  createdAtEpochMs: number,
  state: TState,
): VersionedSnapshot<TState> {
  assertSchemaVersion(
    schemaVersion,
  );
  assertEpochMs(createdAtEpochMs);

  return {
    schemaVersion,
    createdAtEpochMs,
    state,
  };
}
