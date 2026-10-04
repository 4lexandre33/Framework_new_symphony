import {
  createDomainId,
} from "../entities/DomainId";

import type {
  DomainId,
} from "../entities/DomainId";

export type StoryFlagId =
  DomainId<"story-flag">;

export interface StoryFlagSetSnapshot {
  readonly flagIds:
    readonly string[];
}

export type StoryFlagSetErrorCode =
  | "duplicate-flag"
  | "invalid-snapshot";

export class StoryFlagSetError
  extends Error {
  public readonly name =
    "StoryFlagSetError";

  public constructor(
    public readonly code:
      StoryFlagSetErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function createStoryFlagId(
  value: string,
): StoryFlagId {
  return createDomainId<
    "story-flag"
  >(value);
}

function compareStoryFlagId(
  left:
    StoryFlagId,
  right:
    StoryFlagId,
): number {
  return left < right
    ? -1
    : left > right
      ? 1
      : 0;
}

/**
 * Set de facts narrativos booleanos.
 *
 * Presença = true.
 * Ausência = false.
 */
export class StoryFlagSet {
  private readonly flags =
    new Set<StoryFlagId>();

  public constructor(
    initial:
      readonly StoryFlagId[] = [],
  ) {
    for (
      const flagId of
      initial
    ) {
      if (
        this.flags.has(
          flagId,
        )
      ) {
        throw new StoryFlagSetError(
          "duplicate-flag",
          `StoryFlagId duplicado: "${flagId}".`,
        );
      }

      this.flags.add(
        flagId,
      );
    }
  }

  public static fromSnapshot(
    snapshot:
      StoryFlagSetSnapshot,
  ): StoryFlagSet {
    try {
      return new StoryFlagSet(
        snapshot.flagIds.map(
          (value) =>
            createStoryFlagId(
              value,
            ),
        ),
      );
    } catch (error) {
      throw new StoryFlagSetError(
        "invalid-snapshot",
        `StoryFlagSetSnapshot inválido: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );
    }
  }

  public get size():
    number {
    return this.flags.size;
  }

  public get isEmpty():
    boolean {
    return this.flags.size === 0;
  }

  public has(
    flagId:
      StoryFlagId,
  ): boolean {
    return this.flags.has(
      flagId,
    );
  }

  /**
   * Retorna true somente quando houve mudança false -> true.
   */
  public set(
    flagId:
      StoryFlagId,
  ): boolean {
    const before =
      this.flags.size;

    this.flags.add(
      flagId,
    );

    return (
      this.flags.size >
      before
    );
  }

  /**
   * Retorna true somente quando houve mudança true -> false.
   */
  public clear(
    flagId:
      StoryFlagId,
  ): boolean {
    return this.flags.delete(
      flagId,
    );
  }

  public clearAll(): void {
    this.flags.clear();
  }

  public forEach(
    visitor: (
      flagId:
        StoryFlagId,
    ) => void,
  ): void {
    for (
      const flagId of
      this.flags
    ) {
      visitor(flagId);
    }
  }

  public toSnapshot():
    StoryFlagSetSnapshot {
    const flagIds =
      [...this.flags]
        .sort(
          compareStoryFlagId,
        );

    return Object.freeze({
      flagIds:
        Object.freeze(
          flagIds,
        ),
    });
  }
}
