import type {
  DefinitionId,
  DefinitionKindId,
} from "./DefinitionId";

import type {
  DefinitionRef,
} from "./DefinitionRef";

import type {
  DefinitionSetView,
} from "./DefinitionSet";

export type GameDefinitionsErrorCode =
  | "duplicate-kind"
  | "unknown-kind"
  | "unknown-definition";

export class GameDefinitionsError
  extends Error {
  public readonly name =
    "GameDefinitionsError";

  public constructor(
    public readonly code:
      GameDefinitionsErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function compareKindId(
  left:
    DefinitionKindId,
  right:
    DefinitionKindId,
): number {
  return left < right
    ? -1
    : left > right
      ? 1
      : 0;
}

/**
 * Registry imutável de DefinitionSets.
 *
 * Todos os sets são instalados no construtor; não existe registro dinâmico.
 */
export class GameDefinitions {
  private readonly sets =
    new Map<
      DefinitionKindId,
      DefinitionSetView
    >();

  private readonly kindIds:
    readonly DefinitionKindId[];

  public constructor(
    sets:
      readonly DefinitionSetView[] =
        [],
  ) {
    for (const set of sets) {
      if (
        this.sets.has(
          set.kindId,
        )
      ) {
        throw new GameDefinitionsError(
          "duplicate-kind",
          `DefinitionKindId duplicado: "${set.kindId}".`,
        );
      }

      this.sets.set(
        set.kindId,
        set,
      );
    }

    this.kindIds =
      Object.freeze(
        [...this.sets.keys()]
          .sort(compareKindId),
      );
  }

  public get kindCount():
    number {
    return this.sets.size;
  }

  public hasKind(
    kindId:
      DefinitionKindId,
  ): boolean {
    return this.sets.has(
      kindId,
    );
  }

  public has(
    ref:
      DefinitionRef<unknown>,
  ): boolean {
    return (
      this.sets
        .get(ref.kindId)
        ?.has(
          ref.definitionId,
        ) ??
      false
    );
  }

  public getKindIds():
    readonly DefinitionKindId[] {
    return this.kindIds;
  }

  public getSet(
    kindId:
      DefinitionKindId,
  ): DefinitionSetView | null {
    return (
      this.sets.get(kindId) ??
      null
    );
  }

  public requireSet(
    kindId:
      DefinitionKindId,
  ): DefinitionSetView {
    const set =
      this.sets.get(kindId);

    if (set === undefined) {
      throw new GameDefinitionsError(
        "unknown-kind",
        `DefinitionKindId desconhecido: "${kindId}".`,
      );
    }

    return set;
  }

  public resolve<
    TDefinition = unknown,
  >(
    ref:
      DefinitionRef<TDefinition>,
  ): Readonly<TDefinition> | null {
    const set =
      this.sets.get(
        ref.kindId,
      );

    if (set === undefined) {
      return null;
    }

    const value =
      set.getUnknown(
        ref.definitionId,
      );

    return value as
      | Readonly<TDefinition>
      | null;
  }

  public require<
    TDefinition = unknown,
  >(
    ref:
      DefinitionRef<TDefinition>,
  ): Readonly<TDefinition> {
    const set =
      this.sets.get(
        ref.kindId,
      );

    if (set === undefined) {
      throw new GameDefinitionsError(
        "unknown-kind",
        `DefinitionKindId desconhecido: "${ref.kindId}".`,
      );
    }

    const value =
      set.getUnknown(
        ref.definitionId,
      );

    if (value === null) {
      throw new GameDefinitionsError(
        "unknown-definition",
        `DefinitionId desconhecido em "${ref.kindId}": "${ref.definitionId}".`,
      );
    }

    return value as
      Readonly<TDefinition>;
  }

  public hasDefinition(
    kindId:
      DefinitionKindId,
    definitionId:
      DefinitionId,
  ): boolean {
    return (
      this.sets
        .get(kindId)
        ?.has(definitionId) ??
      false
    );
  }
}
