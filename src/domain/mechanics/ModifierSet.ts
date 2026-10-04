import {
  Modifier,
} from "./Modifier";

import type {
  ModifierSnapshot,
} from "./Modifier";

import type {
  ModifierId,
  ModifierTargetId,
} from "./ModifierId";

import {
  applyModifierOperation,
} from "./ModifierOperation";

export interface ModifierSetSnapshot {
  readonly modifiers:
    readonly ModifierSnapshot[];
}

export type ModifierSetErrorCode =
  | "duplicate-modifier"
  | "invalid-base-value"
  | "invalid-snapshot";

export class ModifierSetError
  extends Error {
  public readonly name =
    "ModifierSetError";

  public constructor(
    public readonly code:
      ModifierSetErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function compareModifier(
  left: Modifier,
  right: Modifier,
): number {
  const priorityDifference =
    left.priority -
    right.priority;

  if (
    priorityDifference !== 0
  ) {
    return priorityDifference;
  }

  if (left.id < right.id) {
    return -1;
  }

  if (left.id > right.id) {
    return 1;
  }

  return 0;
}

function compareSnapshot(
  left: ModifierSnapshot,
  right: ModifierSnapshot,
): number {
  if (
    left.targetId <
    right.targetId
  ) {
    return -1;
  }

  if (
    left.targetId >
    right.targetId
  ) {
    return 1;
  }

  const priorityDifference =
    left.priority -
    right.priority;

  if (
    priorityDifference !== 0
  ) {
    return priorityDifference;
  }

  if (left.id < right.id) {
    return -1;
  }

  if (left.id > right.id) {
    return 1;
  }

  return 0;
}

/**
 * Conjunto mutável de Modifier definitions com índice de avaliação por target.
 *
 * Mutação (add/remove) reconstrói apenas o bucket afetado.
 * evaluate() não ordena, não cria arrays e não cria snapshots.
 */
export class ModifierSet {
  private readonly modifiers =
    new Map<
      ModifierId,
      Modifier
    >();

  private readonly byTarget =
    new Map<
      ModifierTargetId,
      readonly Modifier[]
    >();

  public static fromSnapshot(
    snapshot:
      ModifierSetSnapshot,
  ): ModifierSet {
    const set =
      new ModifierSet();

    try {
      for (
        const modifierSnapshot of
        snapshot.modifiers
      ) {
        set.add(
          Modifier.fromSnapshot(
            modifierSnapshot,
          ),
        );
      }
    } catch (error) {
      if (
        error instanceof
        ModifierSetError
      ) {
        throw new ModifierSetError(
          "invalid-snapshot",
          `ModifierSetSnapshot inválido: ${error.message}`,
        );
      }

      throw new ModifierSetError(
        "invalid-snapshot",
        `ModifierSetSnapshot inválido: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );
    }

    return set;
  }

  public get size():
    number {
    return this.modifiers.size;
  }

  public get isEmpty():
    boolean {
    return (
      this.modifiers.size ===
      0
    );
  }

  public has(
    modifierId:
      ModifierId,
  ): boolean {
    return this.modifiers.has(
      modifierId,
    );
  }

  public get(
    modifierId:
      ModifierId,
  ): Modifier | undefined {
    return this.modifiers.get(
      modifierId,
    );
  }

  public add(
    modifier: Modifier,
  ): void {
    if (
      this.modifiers.has(
        modifier.id,
      )
    ) {
      throw new ModifierSetError(
        "duplicate-modifier",
        `ModifierId duplicado: "${modifier.id}".`,
      );
    }

    this.modifiers.set(
      modifier.id,
      modifier,
    );

    this.rebuildTarget(
      modifier.targetId,
    );
  }

  public remove(
    modifierId:
      ModifierId,
  ): boolean {
    const existing =
      this.modifiers.get(
        modifierId,
      );

    if (
      existing === undefined
    ) {
      return false;
    }

    this.modifiers.delete(
      modifierId,
    );

    this.rebuildTarget(
      existing.targetId,
    );

    return true;
  }

  public clear(): void {
    this.modifiers.clear();
    this.byTarget.clear();
  }

  public countForTarget(
    targetId:
      ModifierTargetId,
  ): number {
    return (
      this.byTarget.get(
        targetId,
      )?.length ??
      0
    );
  }

  /**
   * Retorna o bucket interno readonly/frozen sem cópia.
   */
  public getModifiersForTarget(
    targetId:
      ModifierTargetId,
  ): readonly Modifier[] {
    return (
      this.byTarget.get(
        targetId,
      ) ?? EMPTY_MODIFIERS
    );
  }

  /**
   * Aplica a pipeline já ordenada:
   *
   * 1. priority crescente;
   * 2. empate por ModifierId lexicográfico;
   * 3. cada operation recebe o resultado da anterior.
   *
   * Portanto um override de priority maior acontece mais tarde e prevalece
   * sobre resultados anteriores, até que outro modifier posterior o altere.
   */
  public evaluate(
    targetId:
      ModifierTargetId,
    baseValue: number,
  ): number {
    if (
      !Number.isFinite(
        baseValue,
      )
    ) {
      throw new ModifierSetError(
        "invalid-base-value",
        "ModifierSet.evaluate baseValue deve ser um number finito.",
      );
    }

    let current =
      baseValue;

    const bucket =
      this.byTarget.get(
        targetId,
      );

    if (
      bucket === undefined
    ) {
      return current;
    }

    for (
      const modifier of
      bucket
    ) {
      current =
        applyModifierOperation(
          current,
          modifier.operation,
        );
    }

    return current;
  }

  public forEach(
    visitor: (
      modifier: Modifier,
    ) => void,
  ): void {
    for (
      const modifier of
      this.modifiers.values()
    ) {
      visitor(modifier);
    }
  }

  /**
   * Snapshot determinístico:
   * targetId -> priority -> ModifierId.
   */
  public toSnapshot():
    ModifierSetSnapshot {
    const snapshots:
      ModifierSnapshot[] = [];

    for (
      const modifier of
      this.modifiers.values()
    ) {
      snapshots.push(
        modifier.toSnapshot(),
      );
    }

    snapshots.sort(
      compareSnapshot,
    );

    return Object.freeze({
      modifiers:
        Object.freeze(
          snapshots,
        ),
    });
  }

  private rebuildTarget(
    targetId:
      ModifierTargetId,
  ): void {
    const bucket:
      Modifier[] = [];

    for (
      const modifier of
      this.modifiers.values()
    ) {
      if (
        modifier.targetId ===
        targetId
      ) {
        bucket.push(
          modifier,
        );
      }
    }

    if (
      bucket.length === 0
    ) {
      this.byTarget.delete(
        targetId,
      );

      return;
    }

    bucket.sort(
      compareModifier,
    );

    this.byTarget.set(
      targetId,
      Object.freeze(
        bucket,
      ),
    );
  }
}

const EMPTY_MODIFIERS:
  readonly Modifier[] =
    Object.freeze([]);
