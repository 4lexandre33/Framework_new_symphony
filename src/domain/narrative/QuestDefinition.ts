import type {
  QuestGoalId,
  QuestGoalKindId,
  QuestGoalTargetId,
} from "./QuestGoal";

import type {
  QuestId,
} from "./QuestId";

export interface QuestGoalDefinition {
  readonly id:
    QuestGoalId;
  readonly kindId:
    QuestGoalKindId;
  readonly targetId:
    QuestGoalTargetId | null;
  readonly requiredProgress:
    number;
}

export interface QuestGoalDefinitionInput {
  readonly id:
    QuestGoalId;
  readonly kindId:
    QuestGoalKindId;
  readonly targetId?:
    QuestGoalTargetId | null;
  readonly requiredProgress?:
    number;
}

export interface QuestDefinitionCreateOptions {
  readonly id:
    QuestId;
  readonly title:
    string;
  readonly description?:
    string | null;
  readonly goals:
    readonly QuestGoalDefinitionInput[];
}

export type QuestDefinitionErrorCode =
  | "invalid-title"
  | "invalid-description"
  | "empty-goals"
  | "duplicate-goal"
  | "invalid-required-progress"
  | "unknown-goal";

export class QuestDefinitionError
  extends Error {
  public readonly name =
    "QuestDefinitionError";

  public constructor(
    public readonly code:
      QuestDefinitionErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const MAX_QUEST_TITLE_LENGTH =
  160;

const MAX_QUEST_DESCRIPTION_LENGTH =
  4_096;

function assertText(
  value: string,
  fieldName: string,
  maxLength: number,
  code:
    | "invalid-title"
    | "invalid-description",
): void {
  if (
    value.length === 0 ||
    value.length >
      maxLength ||
    value !== value.trim()
  ) {
    throw new QuestDefinitionError(
      code,
      `${fieldName} deve ser não vazio, sem whitespace nas extremidades e ter no máximo ${String(maxLength)} caracteres.`,
    );
  }
}

function assertDescription(
  value: string | null,
): void {
  if (value === null) {
    return;
  }

  if (
    value.length >
      MAX_QUEST_DESCRIPTION_LENGTH ||
    value !== value.trim()
  ) {
    throw new QuestDefinitionError(
      "invalid-description",
      `description deve estar sem whitespace nas extremidades e ter no máximo ${String(MAX_QUEST_DESCRIPTION_LENGTH)} caracteres.`,
    );
  }
}

function compareQuestGoalId(
  left:
    QuestGoalId,
  right:
    QuestGoalId,
): number {
  return left < right
    ? -1
    : left > right
      ? 1
      : 0;
}

/**
 * Definição imutável de quest.
 *
 * Todos os goals declarados nesta etapa são obrigatórios. Regras opcionais,
 * alternativas ou ramificadas não são inferidas automaticamente.
 */
export class QuestDefinition {
  public readonly id:
    QuestId;

  public readonly title:
    string;

  public readonly description:
    string | null;

  private readonly goals:
    readonly QuestGoalDefinition[];

  private readonly goalsById =
    new Map<
      QuestGoalId,
      QuestGoalDefinition
    >();

  public constructor(
    options:
      QuestDefinitionCreateOptions,
  ) {
    assertText(
      options.title,
      "title",
      MAX_QUEST_TITLE_LENGTH,
      "invalid-title",
    );

    const description =
      options.description ??
      null;

    assertDescription(
      description,
    );

    if (
      options.goals.length ===
      0
    ) {
      throw new QuestDefinitionError(
        "empty-goals",
        "QuestDefinition exige ao menos um QuestGoal.",
      );
    }

    const copy:
      QuestGoalDefinition[] =
        [];

    for (
      const goal of
      options.goals
    ) {
      if (
        this.goalsById.has(
          goal.id,
        )
      ) {
        throw new QuestDefinitionError(
          "duplicate-goal",
          `QuestGoalId duplicado: "${goal.id}".`,
        );
      }

      const requiredProgress =
        goal.requiredProgress ??
        1;

      if (
        !Number.isSafeInteger(
          requiredProgress,
        ) ||
        requiredProgress < 1
      ) {
        throw new QuestDefinitionError(
          "invalid-required-progress",
          `requiredProgress inválido para "${goal.id}".`,
        );
      }

      const normalized =
        Object.freeze({
          id: goal.id,
          kindId:
            goal.kindId,
          targetId:
            goal.targetId ??
            null,
          requiredProgress,
        });

      this.goalsById.set(
        goal.id,
        normalized,
      );

      copy.push(
        normalized,
      );
    }

    copy.sort(
      (left, right) =>
        compareQuestGoalId(
          left.id,
          right.id,
        ),
    );

    this.id = options.id;
    this.title =
      options.title;
    this.description =
      description;
    this.goals =
      Object.freeze(copy);
  }

  public get goalCount():
    number {
    return this.goals.length;
  }

  public hasGoal(
    goalId:
      QuestGoalId,
  ): boolean {
    return this.goalsById.has(
      goalId,
    );
  }

  public getGoal(
    goalId:
      QuestGoalId,
  ): QuestGoalDefinition {
    const goal =
      this.goalsById.get(
        goalId,
      );

    if (
      goal === undefined
    ) {
      throw new QuestDefinitionError(
        "unknown-goal",
        `QuestGoal desconhecido: "${goalId}".`,
      );
    }

    return goal;
  }

  public getGoals():
    readonly QuestGoalDefinition[] {
    return this.goals;
  }
}
