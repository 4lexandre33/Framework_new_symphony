import {
  createDomainId,
} from "../entities/DomainId";

import type {
  DomainId,
} from "../entities/DomainId";

export type UnlockId =
  DomainId<"unlock">;

export interface UnlockSetSnapshot {
  readonly unlockIds:
    readonly string[];
}

export type UnlockSetErrorCode =
  | "duplicate-unlock"
  | "invalid-snapshot";

export class UnlockSetError
  extends Error {
  public readonly name =
    "UnlockSetError";

  public constructor(
    public readonly code:
      UnlockSetErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function createUnlockId(
  value: string,
): UnlockId {
  return createDomainId<
    "unlock"
  >(value);
}

function compareUnlockId(
  left:
    UnlockId,
  right:
    UnlockId,
): number {
  return left < right
    ? -1
    : left > right
      ? 1
      : 0;
}

/**
 * Set runtime de desbloqueios semânticos.
 *
 * UnlockId pode representar feature, recipe, ability, skill, chapter etc.
 * A Etapa 57 não conecta automaticamente esses IDs a outros aggregates.
 */
export class UnlockSet {
  private readonly ids =
    new Set<UnlockId>();

  public constructor(
    initial:
      readonly UnlockId[] = [],
  ) {
    for (
      const unlockId of
      initial
    ) {
      if (
        this.ids.has(
          unlockId,
        )
      ) {
        throw new UnlockSetError(
          "duplicate-unlock",
          `UnlockId duplicado: "${unlockId}".`,
        );
      }

      this.ids.add(
        unlockId,
      );
    }
  }

  public static fromSnapshot(
    snapshot:
      UnlockSetSnapshot,
  ): UnlockSet {
    try {
      return new UnlockSet(
        snapshot.unlockIds.map(
          (value) =>
            createUnlockId(
              value,
            ),
        ),
      );
    } catch (error) {
      throw new UnlockSetError(
        "invalid-snapshot",
        `UnlockSetSnapshot inválido: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );
    }
  }

  public get size():
    number {
    return this.ids.size;
  }

  public get isEmpty():
    boolean {
    return this.ids.size === 0;
  }

  public has(
    unlockId:
      UnlockId,
  ): boolean {
    return this.ids.has(
      unlockId,
    );
  }

  /**
   * Retorna true apenas quando o unlock foi adicionado agora.
   */
  public unlock(
    unlockId:
      UnlockId,
  ): boolean {
    const before =
      this.ids.size;

    this.ids.add(
      unlockId,
    );

    return (
      this.ids.size >
      before
    );
  }

  /**
   * Lock explícito para suportar respec/autoria sem impor policy.
   */
  public lock(
    unlockId:
      UnlockId,
  ): boolean {
    return this.ids.delete(
      unlockId,
    );
  }

  public clear(): void {
    this.ids.clear();
  }

  public forEach(
    visitor: (
      unlockId:
        UnlockId,
    ) => void,
  ): void {
    for (
      const unlockId of
      this.ids
    ) {
      visitor(unlockId);
    }
  }

  public toSnapshot():
    UnlockSetSnapshot {
    const unlockIds =
      [...this.ids]
        .sort(
          compareUnlockId,
        );

    return Object.freeze({
      unlockIds:
        Object.freeze(
          unlockIds,
        ),
    });
  }
}
