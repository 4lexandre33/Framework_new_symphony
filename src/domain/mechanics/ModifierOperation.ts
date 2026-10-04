export type ModifierOperationKind =
  | "add"
  | "multiply"
  | "override";

export interface ModifierOperation {
  readonly kind:
    ModifierOperationKind;
  readonly value:
    number;
}

export type ModifierOperationErrorCode =
  | "invalid-value"
  | "invalid-input"
  | "non-finite-result";

export class ModifierOperationError
  extends Error {
  public readonly name =
    "ModifierOperationError";

  public constructor(
    public readonly code:
      ModifierOperationErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function assertFinite(
  value: number,
  label: string,
  code:
    | "invalid-value"
    | "invalid-input",
): void {
  if (!Number.isFinite(value)) {
    throw new ModifierOperationError(
      code,
      `${label} deve ser um number finito.`,
    );
  }
}

export function createModifierOperation(
  kind:
    ModifierOperationKind,
  value: number,
): ModifierOperation {
  assertFinite(
    value,
    "ModifierOperation.value",
    "invalid-value",
  );

  return Object.freeze({
    kind,
    value,
  });
}

/**
 * Aplica uma única operação numérica.
 *
 * add:      current + value
 * multiply: current * value
 * override: value
 *
 * Qualquer overflow para Infinity/NaN falha explicitamente.
 */
export function applyModifierOperation(
  current: number,
  operation:
    ModifierOperation,
): number {
  assertFinite(
    current,
    "current",
    "invalid-input",
  );

  let result: number;

  switch (operation.kind) {
    case "add":
      result =
        current +
        operation.value;
      break;

    case "multiply":
      result =
        current *
        operation.value;
      break;

    case "override":
      result =
        operation.value;
      break;
  }

  if (!Number.isFinite(result)) {
    throw new ModifierOperationError(
      "non-finite-result",
      `ModifierOperation "${operation.kind}" produziu resultado não finito.`,
    );
  }

  return result;
}
