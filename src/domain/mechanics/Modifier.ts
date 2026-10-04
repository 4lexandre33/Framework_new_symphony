import type {
  ModifierId,
  ModifierSourceRef,
  ModifierTargetId,
} from "./ModifierId";

import {
  createModifierId,
  createModifierSourceId,
  createModifierSourceRef,
  createModifierSourceTypeId,
  createModifierTargetId,
} from "./ModifierId";

import type {
  ModifierOperation,
  ModifierOperationKind,
} from "./ModifierOperation";

import {
  createModifierOperation,
} from "./ModifierOperation";

export interface ModifierCreateOptions {
  readonly id:
    ModifierId;
  readonly targetId:
    ModifierTargetId;
  readonly operation:
    ModifierOperation;
  readonly priority?:
    number;
  readonly source?:
    ModifierSourceRef | null;
}

export interface ModifierSnapshot {
  readonly id:
    string;
  readonly targetId:
    string;
  readonly operation:
    ModifierOperationKind;
  readonly value:
    number;
  readonly priority:
    number;
  readonly source:
    | {
        readonly typeId:
          string;
        readonly sourceId:
          string;
      }
    | null;
}

export type ModifierErrorCode =
  | "invalid-priority"
  | "invalid-snapshot";

export class ModifierError
  extends Error {
  public readonly name =
    "ModifierError";

  public constructor(
    public readonly code:
      ModifierErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function assertPriority(
  priority: number,
): void {
  if (
    !Number.isSafeInteger(
      priority,
    )
  ) {
    throw new ModifierError(
      "invalid-priority",
      "Modifier.priority deve ser um inteiro seguro.",
    );
  }
}

function copySource(
  source:
    ModifierSourceRef | null,
): ModifierSourceRef | null {
  if (source === null) {
    return null;
  }

  return createModifierSourceRef(
    source.typeId,
    source.sourceId,
  );
}

/**
 * Definição imutável de uma transformação numérica semântica.
 *
 * targetId identifica um atributo lógico, por exemplo:
 * - attribute.damage
 * - attribute.move-speed
 * - attribute.armor
 * - attribute.critical-chance
 *
 * Não conhece Agent fields, renderer, physics properties ou componentes ECS.
 */
export class Modifier {
  public readonly id:
    ModifierId;

  public readonly targetId:
    ModifierTargetId;

  public readonly operation:
    ModifierOperation;

  public readonly priority:
    number;

  public readonly source:
    ModifierSourceRef | null;

  public constructor(
    options:
      ModifierCreateOptions,
  ) {
    const priority =
      options.priority ?? 0;

    assertPriority(priority);

    this.id = options.id;
    this.targetId =
      options.targetId;
    this.operation =
      createModifierOperation(
        options.operation.kind,
        options.operation.value,
      );
    this.priority =
      priority;
    this.source =
      copySource(
        options.source ?? null,
      );
  }

  public static fromSnapshot(
    snapshot:
      ModifierSnapshot,
  ): Modifier {
    try {
      return new Modifier({
        id:
          createModifierId(
            snapshot.id,
          ),
        targetId:
          createModifierTargetId(
            snapshot.targetId,
          ),
        operation:
          createModifierOperation(
            snapshot.operation,
            snapshot.value,
          ),
        priority:
          snapshot.priority,
        source:
          snapshot.source ===
          null
            ? null
            : createModifierSourceRef(
                createModifierSourceTypeId(
                  snapshot.source
                    .typeId,
                ),
                createModifierSourceId(
                  snapshot.source
                    .sourceId,
                ),
              ),
      });
    } catch (error) {
      throw new ModifierError(
        "invalid-snapshot",
        `ModifierSnapshot inválido: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );
    }
  }

  public toSnapshot():
    ModifierSnapshot {
    return {
      id: this.id,
      targetId:
        this.targetId,
      operation:
        this.operation.kind,
      value:
        this.operation.value,
      priority:
        this.priority,
      source:
        this.source === null
          ? null
          : {
              typeId:
                this.source
                  .typeId,
              sourceId:
                this.source
                  .sourceId,
            },
    };
  }
}
