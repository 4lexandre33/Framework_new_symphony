import {
  cloneStateValue,
} from "../state/StateValue";

import type {
  StateValue,
} from "../state/StateValue";

export type SnapshotValue =
  StateValue;

export type SnapshotValueErrorCode =
  "invalid-snapshot-value";

export class SnapshotValueError
  extends Error {
  public readonly name =
    "SnapshotValueError";

  public constructor(
    public readonly code:
      SnapshotValueErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Normaliza um payload de snapshot para uma árvore JSON-safe:
 * - apenas null / boolean / string / number finito;
 * - arrays;
 * - objetos simples;
 * - sem ciclos;
 * - keys de objetos ordenadas;
 * - resultado profundamente frozen.
 *
 * Reaproveita a mesma política já validada por StateValue.
 */
export function cloneSnapshotValue(
  value: unknown,
): SnapshotValue {
  try {
    return cloneStateValue(
      value,
    );
  } catch (error) {
    throw new SnapshotValueError(
      "invalid-snapshot-value",
      `Snapshot payload inválido: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`,
    );
  }
}
