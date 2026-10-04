import {
  QuestGoal,
  QuestGoalError,
} from "./QuestGoal";

import type {
  QuestGoalId,
  QuestGoalSnapshot,
} from "./QuestGoal";

import type {
  QuestDefinition,
  QuestGoalDefinition,
} from "./QuestDefinition";

import {
  createQuestId,
} from "./QuestId";

import type {
  QuestId,
} from "./QuestId";

export type QuestStatus =
  | "inactive"
  | "active"
  | "completed"
  | "failed";

export interface QuestStateSnapshot {
  readonly questId:
    string;
  readonly status:
    QuestStatus;
  readonly goals:
    readonly QuestGoalSnapshot[];
}

export type QuestStateErrorCode =
  | "invalid-transition"
  | "unknown-goal"
  | "definition-mismatch"
  | "inconsistent-snapshot"
  | "invalid-snapshot";

export class QuestStateError
  extends Error {
  public readonly name =
    "QuestStateError";

  public constructor(
    public readonly code:
      QuestStateErrorCode,
    message: string,
  ) {
    super(message);
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

function createGoal(
  definition:
    QuestGoalDefinition,
): QuestGoal {
  return new QuestGoal({
    id: definition.id,
    kindId:
      definition.kindId,
    targetId:
      definition.targetId,
    requiredProgress:
      definition.requiredProgress,
  });
}

/**
 * Estado runtime multi-goal de uma QuestDefinition.
 *
 * Política da Etapa 58:
 * - todos os goals são obrigatórios;
 * - todos são ativados ao ativar a quest;
 * - todos completed => quest completed;
 * - qualquer goal failed => quest failed;
 * - ao falhar a quest, goals ainda active são terminalizados como failed.
 */
export class QuestState {
  public readonly questId:
    QuestId;

  private statusValue:
    QuestStatus =
      "inactive";

  private readonly goals =
    new Map<
      QuestGoalId,
      QuestGoal
    >();

  public constructor(
    definition:
      QuestDefinition,
  ) {
    this.questId =
      definition.id;

    for (
      const goalDefinition of
      definition.getGoals()
    ) {
      this.goals.set(
        goalDefinition.id,
        createGoal(
          goalDefinition,
        ),
      );
    }
  }

  public static fromSnapshot(
    definition:
      QuestDefinition,
    snapshot:
      QuestStateSnapshot,
  ): QuestState {
    let snapshotQuestId:
      QuestId;

    try {
      snapshotQuestId =
        createQuestId(
          snapshot.questId,
        );
    } catch (error) {
      throw new QuestStateError(
        "invalid-snapshot",
        `QuestStateSnapshot possui questId inválido: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );
    }

    if (
      snapshotQuestId !==
      definition.id
    ) {
      throw new QuestStateError(
        "definition-mismatch",
        `QuestStateSnapshot "${snapshotQuestId}" não pertence à definição "${definition.id}".`,
      );
    }

    if (
      snapshot.goals.length !==
      definition.goalCount
    ) {
      throw new QuestStateError(
        "definition-mismatch",
        "Quantidade de goals no snapshot difere da QuestDefinition.",
      );
    }

    const state =
      new QuestState(
        definition,
      );

    const restored =
      new Map<
        QuestGoalId,
        QuestGoal
      >();

    for (
      const goalSnapshot of
      snapshot.goals
    ) {
      if (
        restored.has(
          goalSnapshot.id,
        )
      ) {
        throw new QuestStateError(
          "inconsistent-snapshot",
          `QuestGoalSnapshot duplicado: "${goalSnapshot.id}".`,
        );
      }

      const goalDefinition =
        definition.hasGoal(
          goalSnapshot.id,
        )
          ? definition.getGoal(
              goalSnapshot.id,
            )
          : null;

      if (
        goalDefinition ===
        null
      ) {
        throw new QuestStateError(
          "definition-mismatch",
          `QuestGoal "${goalSnapshot.id}" não existe na QuestDefinition.`,
        );
      }

      if (
        goalDefinition.kindId !==
          goalSnapshot.kindId ||
        goalDefinition.targetId !==
          goalSnapshot.targetId ||
        goalDefinition.requiredProgress !==
          goalSnapshot.requiredProgress
      ) {
        throw new QuestStateError(
          "definition-mismatch",
          `QuestGoal "${goalSnapshot.id}" difere da definição estática.`,
        );
      }

      let restoredGoal:
        QuestGoal;

      try {
        restoredGoal =
          QuestGoal.fromSnapshot(
            goalSnapshot,
          );
      } catch (error) {
        throw new QuestStateError(
          "invalid-snapshot",
          `QuestGoalSnapshot inválido para "${goalSnapshot.id}": ${
            error instanceof Error
              ? error.message
              : String(error)
          }`,
        );
      }

      restored.set(
        goalSnapshot.id,
        restoredGoal,
      );
    }

    state.goals.clear();

    for (
      const [
        goalId,
        goal,
      ] of restored
    ) {
      state.goals.set(
        goalId,
        goal,
      );
    }

    state.statusValue =
      snapshot.status;

    state.assertStatusConsistency();

    return state;
  }

  public get status():
    QuestStatus {
    return this.statusValue;
  }

  public get goalCount():
    number {
    return this.goals.size;
  }

  public get isTerminal():
    boolean {
    return (
      this.statusValue ===
        "completed" ||
      this.statusValue ===
        "failed"
    );
  }

  public getGoal(
    goalId:
      QuestGoalId,
  ): QuestGoal {
    const goal =
      this.goals.get(
        goalId,
      );

    if (
      goal === undefined
    ) {
      throw new QuestStateError(
        "unknown-goal",
        `QuestGoal desconhecido em "${this.questId}": "${goalId}".`,
      );
    }

    return goal;
  }

  public activate(): void {
    if (
      this.statusValue !==
      "inactive"
    ) {
      throw new QuestStateError(
        "invalid-transition",
        `QuestState só pode ativar a partir de inactive; estado atual: "${this.statusValue}".`,
      );
    }

    for (
      const goal of
      this.goals.values()
    ) {
      goal.activate();
    }

    this.statusValue =
      "active";
  }

  public advanceGoal(
    goalId:
      QuestGoalId,
    amount:
      number = 1,
  ): number {
    this.requireActive();

    const goal =
      this.getGoal(
        goalId,
      );

    let applied:
      number;

    try {
      applied =
        goal.advance(amount);
    } catch (error) {
      this.rethrowGoalError(
        goalId,
        error,
      );
    }

    this.refreshCompletion();

    return applied!;
  }

  public completeGoal(
    goalId:
      QuestGoalId,
  ): void {
    this.requireActive();

    const goal =
      this.getGoal(
        goalId,
      );

    try {
      goal.complete();
    } catch (error) {
      this.rethrowGoalError(
        goalId,
        error,
      );
    }

    this.refreshCompletion();
  }

  public failGoal(
    goalId:
      QuestGoalId,
  ): void {
    this.requireActive();

    const goal =
      this.getGoal(
        goalId,
      );

    try {
      goal.fail();
    } catch (error) {
      this.rethrowGoalError(
        goalId,
        error,
      );
    }

    this.failRemainingActiveGoals();

    this.statusValue =
      "failed";
  }

  public fail(): void {
    this.requireActive();

    this.failRemainingActiveGoals();

    this.statusValue =
      "failed";
  }

  public forEachGoal(
    visitor: (
      goal:
        QuestGoal,
    ) => void,
  ): void {
    for (
      const goal of
      this.goals.values()
    ) {
      visitor(goal);
    }
  }

  public toSnapshot():
    QuestStateSnapshot {
    const goalSnapshots:
      QuestGoalSnapshot[] =
        [];

    for (
      const goal of
      this.goals.values()
    ) {
      goalSnapshots.push(
        goal.toSnapshot(),
      );
    }

    goalSnapshots.sort(
      (left, right) =>
        compareQuestGoalId(
          left.id,
          right.id,
        ),
    );

    return Object.freeze({
      questId:
        this.questId,
      status:
        this.statusValue,
      goals:
        Object.freeze(
          goalSnapshots,
        ),
    });
  }

  private requireActive():
    void {
    if (
      this.statusValue !==
      "active"
    ) {
      throw new QuestStateError(
        "invalid-transition",
        `QuestState precisa estar active; estado atual: "${this.statusValue}".`,
      );
    }
  }

  private refreshCompletion():
    void {
    for (
      const goal of
      this.goals.values()
    ) {
      if (
        goal.status !==
        "completed"
      ) {
        return;
      }
    }

    this.statusValue =
      "completed";
  }

  private failRemainingActiveGoals():
    void {
    for (
      const goal of
      this.goals.values()
    ) {
      if (
        goal.status ===
        "active"
      ) {
        goal.fail();
      }
    }
  }

  private rethrowGoalError(
    goalId:
      QuestGoalId,
    error:
      unknown,
  ): never {
    if (
      error instanceof
      QuestGoalError
    ) {
      throw new QuestStateError(
        "invalid-transition",
        `Operação inválida no goal "${goalId}": ${error.message}`,
      );
    }

    throw error;
  }

  private assertStatusConsistency():
    void {
    let inactive = 0;
    let active = 0;
    let completed = 0;
    let failed = 0;

    for (
      const goal of
      this.goals.values()
    ) {
      switch (
        goal.status
      ) {
        case "inactive":
          inactive += 1;
          break;
        case "active":
          active += 1;
          break;
        case "completed":
          completed += 1;
          break;
        case "failed":
          failed += 1;
          break;
      }
    }

    switch (
      this.statusValue
    ) {
      case "inactive":
        if (
          inactive !==
          this.goals.size
        ) {
          throw new QuestStateError(
            "inconsistent-snapshot",
            "QuestState inactive exige todos os goals inactive.",
          );
        }
        return;

      case "active":
        if (
          inactive !== 0 ||
          failed !== 0 ||
          active === 0
        ) {
          throw new QuestStateError(
            "inconsistent-snapshot",
            "QuestState active exige ao menos um goal active e nenhum inactive/failed.",
          );
        }
        return;

      case "completed":
        if (
          completed !==
          this.goals.size
        ) {
          throw new QuestStateError(
            "inconsistent-snapshot",
            "QuestState completed exige todos os goals completed.",
          );
        }
        return;

      case "failed":
        if (
          inactive !== 0 ||
          active !== 0 ||
          failed === 0
        ) {
          throw new QuestStateError(
            "inconsistent-snapshot",
            "QuestState failed exige todos os goals terminais e ao menos um failed.",
          );
        }
    }
  }
}
