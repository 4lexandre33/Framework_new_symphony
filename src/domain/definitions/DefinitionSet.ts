import type {
  DefinitionId,
  DefinitionKindId,
} from "./DefinitionId";

import {
  createDefinitionRef,
} from "./DefinitionRef";

import type {
  DefinitionRef,
} from "./DefinitionRef";

import {
  runDefinitionValidators,
} from "./DefinitionValidator";

import type {
  DefinitionValidationIssue,
  DefinitionValidator,
  DefinitionValidatorId,
} from "./DefinitionValidator";

export interface DefinitionSetEntry<
  TDefinition,
> {
  readonly id:
    DefinitionId;
  readonly value:
    TDefinition;
}

export interface DefinitionSetView {
  readonly kindId:
    DefinitionKindId;
  readonly size:
    number;
  has(
    definitionId:
      DefinitionId,
  ): boolean;
  getUnknown(
    definitionId:
      DefinitionId,
  ): unknown | null;
  getDefinitionIds():
    readonly DefinitionId[];
}

export type DefinitionSetErrorCode =
  | "empty-set"
  | "duplicate-definition"
  | "duplicate-validator"
  | "validation-failed"
  | "unknown-definition";

export class DefinitionSetError
  extends Error {
  public readonly name =
    "DefinitionSetError";

  public constructor(
    public readonly code:
      DefinitionSetErrorCode,
    message: string,
    public readonly issues:
      readonly DefinitionValidationIssue[] =
        Object.freeze([]),
  ) {
    super(message);
  }
}

function compareDefinitionId(
  left:
    DefinitionId,
  right:
    DefinitionId,
): number {
  return left < right
    ? -1
    : left > right
      ? 1
      : 0;
}

function compareValidatorId(
  left:
    DefinitionValidatorId,
  right:
    DefinitionValidatorId,
): number {
  return left < right
    ? -1
    : left > right
      ? 1
      : 0;
}

/**
 * Registry imutável de um único kind de definição.
 *
 * O Set valida todas as entradas no construtor e depois fica read-only.
 */
export class DefinitionSet<
  TDefinition,
> implements DefinitionSetView {
  public readonly kindId:
    DefinitionKindId;

  private readonly definitions =
    new Map<
      DefinitionId,
      Readonly<TDefinition>
    >();

  private readonly definitionIds:
    readonly DefinitionId[];

  public constructor(
    kindId:
      DefinitionKindId,
    entries:
      readonly DefinitionSetEntry<TDefinition>[],
    validators:
      readonly DefinitionValidator<TDefinition>[] =
        [],
  ) {
    if (entries.length === 0) {
      throw new DefinitionSetError(
        "empty-set",
        `DefinitionSet "${kindId}" exige ao menos uma definição.`,
      );
    }

    const sortedValidators =
      [...validators]
        .sort(
          (left, right) =>
            compareValidatorId(
              left.id,
              right.id,
            ),
        );

    const validatorIds =
      new Set<
        DefinitionValidatorId
      >();

    for (
      const validator of
      sortedValidators
    ) {
      if (
        validatorIds.has(
          validator.id,
        )
      ) {
        throw new DefinitionSetError(
          "duplicate-validator",
          `DefinitionValidatorId duplicado: "${validator.id}".`,
        );
      }

      validatorIds.add(
        validator.id,
      );
    }

    const sortedEntries =
      [...entries]
        .sort(
          (left, right) =>
            compareDefinitionId(
              left.id,
              right.id,
            ),
        );

    const allIssues:
      DefinitionValidationIssue[] =
        [];

    this.kindId = kindId;

    for (
      const entry of
      sortedEntries
    ) {
      if (
        this.definitions.has(
          entry.id,
        )
      ) {
        throw new DefinitionSetError(
          "duplicate-definition",
          `DefinitionId duplicado em "${kindId}": "${entry.id}".`,
        );
      }

      const value =
        entry.value as
          Readonly<TDefinition>;

      const issues =
        runDefinitionValidators(
          sortedValidators,
          Object.freeze({
            kindId,
            definitionId:
              entry.id,
            value,
          }),
        );

      for (
        const issue of issues
      ) {
        allIssues.push(issue);
      }

      this.definitions.set(
        entry.id,
        value,
      );
    }

    if (allIssues.length > 0) {
      throw new DefinitionSetError(
        "validation-failed",
        `DefinitionSet "${kindId}" possui ${String(allIssues.length)} issue(s) de validação.`,
        Object.freeze(
          allIssues,
        ),
      );
    }

    this.definitionIds =
      Object.freeze(
        sortedEntries.map(
          (entry) =>
            entry.id,
        ),
      );
  }

  public get size():
    number {
    return this.definitions.size;
  }

  public has(
    definitionId:
      DefinitionId,
  ): boolean {
    return this.definitions.has(
      definitionId,
    );
  }

  public get(
    definitionId:
      DefinitionId,
  ): Readonly<TDefinition> | null {
    return (
      this.definitions.get(
        definitionId,
      ) ??
      null
    );
  }

  public require(
    definitionId:
      DefinitionId,
  ): Readonly<TDefinition> {
    const value =
      this.definitions.get(
        definitionId,
      );

    if (value === undefined) {
      throw new DefinitionSetError(
        "unknown-definition",
        `DefinitionId desconhecido em "${this.kindId}": "${definitionId}".`,
      );
    }

    return value;
  }

  public getUnknown(
    definitionId:
      DefinitionId,
  ): unknown | null {
    return this.get(
      definitionId,
    );
  }

  public getDefinitionIds():
    readonly DefinitionId[] {
    return this.definitionIds;
  }

  public createRef(
    definitionId:
      DefinitionId,
  ): DefinitionRef<TDefinition> {
    this.require(
      definitionId,
    );

    return createDefinitionRef<
      TDefinition
    >(
      this.kindId,
      definitionId,
    );
  }

  public forEach(
    visitor: (
      definitionId:
        DefinitionId,
      value:
        Readonly<TDefinition>,
    ) => void,
  ): void {
    for (
      const definitionId of
      this.definitionIds
    ) {
      const value =
        this.definitions.get(
          definitionId,
        );

      if (value === undefined) {
        continue;
      }

      visitor(
        definitionId,
        value,
      );
    }
  }
}
