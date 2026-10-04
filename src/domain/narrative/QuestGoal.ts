import {
  createDomainId,
} from "../entities/DomainId";

import type {
  DomainId,
} from "../entities/DomainId";

export type QuestGoalId =
  DomainId<"quest-goal">;

export type QuestGoalKindId =
  DomainId<"quest-goal-kind">;

export type QuestGoalTargetId =
  DomainId<"quest-goal-target">;

export function createQuestGoalId(
  value: string,
): QuestGoalId {
  return createDomainId<
    "quest-goal"
  >(value);
}

export function createQuestGoalKindId(
  value: string,
): QuestGoalKindId {
  return createDomainId<
    "quest-goal-kind"
  >(value);
}

export function createQuestGoalTargetId(
  value: string,
): QuestGoalTargetId {
  return createDomainId<
    "quest-goal-target"
  >(value);
}

export type QuestGoalStatus =
  | "inactive"
  | "active"
  | "completed"
  | "failed";

export type QuestGoalErrorCode =
  | "invalid-required-progress"
  | "invalid-progress"
  | "invalid-transition"
  | "inconsistent-snapshot";

export class QuestGoalError
  extends Error {
  public readonly name =
    "QuestGoalError";

  public constructor(
    public readonly code:
      QuestGoalErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface QuestGoalCreateOptions {
  readonly id:
    QuestGoalId;
  readonly kindId:
    QuestGoalKindId;
  readonly targetId?:
    QuestGoalTargetId | null;
  readonly requiredProgress?:
    number;
}

export interface QuestGoalSnapshot {
  readonly id:
    QuestGoalId;
  readonly kindId:
    QuestGoalKindId;
  readonly targetId:
    QuestGoalTargetId | null;
  readonly requiredProgress:
    number;
  readonly progress:
    number;
  readonly status:
    QuestGoalStatus;
}

function assertRequiredProgress(
  value: number,
): void {
  if (
    !Number.isSafeInteger(
      value,
    ) ||
    value < 1
  ) {
    throw new QuestGoalError(
      "invalid-required-progress",
      "requiredProgress deve ser um inteiro seguro maior ou igual a 1.",
    );
  }
}

function assertAdvanceAmount(
  value: number,
): void {
  if (
    !Number.isSafeInteger(
      value,
    ) ||
    value < 1
  ) {
    throw new QuestGoalError(
      "invalid-progress",
      "advance amount deve ser um inteiro seguro maior ou igual a 1.",
    );
  }
}

function assertSnapshotConsistency(
  snapshot:
    QuestGoalSnapshot,
): void {
  assertRequiredProgress(
    snapshot.requiredProgress,
  );

  if (
    !Number.isSafeInteger(
      snapshot.progress,
    ) ||
    snapshot.progress < 0 ||
    snapshot.progress >
      snapshot.requiredProgress
  ) {
    throw new QuestGoalError(
      "inconsistent-snapshot",
      "QuestGoalSnapshot possui progress inválido.",
    );
  }

  switch (snapshot.status) {
    case "inactive":
      if (
        snapshot.progress !== 0
      ) {
        throw new QuestGoalError(
          "inconsistent-snapshot",
          "QuestGoal inactive precisa possuir progress 0.",
        );
      }
      return;

    case "active":
      if (
        snapshot.progress >=
        snapshot.requiredProgress
      ) {
        throw new QuestGoalError(
          "inconsistent-snapshot",
          "QuestGoal active precisa possuir progress menor que requiredProgress.",
        );
      }
      return;

    case "completed":
      if (
        snapshot.progress !==
        snapshot.requiredProgress
      ) {
        throw new QuestGoalError(
          "inconsistent-snapshot",
          "QuestGoal completed precisa possuir progress igual a requiredProgress.",
        );
      }
      return;

    case "failed":
      return;
  }
}

/**
 * Objetivo de quest puro e event-driven.
 *
 * `kindId` e `targetId` são identificadores semânticos opacos. Um jogo pode
 * resolver targetId para uma entidade, área, tile, volume, objeto de mundo ou
 * qualquer outro conceito em 2D, 2.5D ou 3D fora desta entidade.
 *
 * Lifecycle:
 * inactive -> active -> completed
 * inactive -> active -> failed
 *
 * advance() satura em requiredProgress e completa automaticamente o goal.
 */
export class QuestGoal {
  public readonly id:
    QuestGoalId;

  public readonly kindId:
    QuestGoalKindId;

  public readonly targetId:
    QuestGoalTargetId | null;

  public readonly requiredProgress:
    number;

  private progressValue =
    0;

  private statusValue:
    QuestGoalStatus =
      "inactive";

  public constructor(
    options:
      QuestGoalCreateOptions,
  ) {
    const requiredProgress =
      options.requiredProgress ??
      1;

    assertRequiredProgress(
      requiredProgress,
    );

    this.id = options.id;
    this.kindId =
      options.kindId;
    this.targetId =
      options.targetId ??
      null;
    this.requiredProgress =
      requiredProgress;
  }

  public static fromSnapshot(
    snapshot:
      QuestGoalSnapshot,
  ): QuestGoal {
    assertSnapshotConsistency(
      snapshot,
    );

    const goal =
      new QuestGoal({
        id: snapshot.id,
        kindId:
          snapshot.kindId,
        targetId:
          snapshot.targetId,
        requiredProgress:
          snapshot.requiredProgress,
      });

    goal.progressValue =
      snapshot.progress;

    goal.statusValue =
      snapshot.status;

    return goal;
  }

  public get progress():
    number {
    return this.progressValue;
  }

  public get status():
    QuestGoalStatus {
    return this.statusValue;
  }

  public get remainingProgress():
    number {
    return (
      this.requiredProgress -
      this.progressValue
    );
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

  public activate(): void {
    if (
      this.statusValue !==
      "inactive"
    ) {
      throw new QuestGoalError(
        "invalid-transition",
        `QuestGoal só pode ser ativado a partir de "inactive"; estado atual: "${this.statusValue}".`,
      );
    }

    this.statusValue =
      "active";
  }

  /**
   * Avança progresso e retorna a quantidade efetivamente aplicada.
   */
  public advance(
    amount: number = 1,
  ): number {
    assertAdvanceAmount(
      amount,
    );

    if (
      this.statusValue !==
      "active"
    ) {
      throw new QuestGoalError(
        "invalid-transition",
        `QuestGoal só pode avançar a partir de "active"; estado atual: "${this.statusValue}".`,
      );
    }

    const remaining =
      this.requiredProgress -
      this.progressValue;

    const applied =
      Math.min(
        amount,
        remaining,
      );

    this.progressValue +=
      applied;

    if (
      this.progressValue ===
      this.requiredProgress
    ) {
      this.statusValue =
        "completed";
    }

    return applied;
  }

  public complete(): void {
    if (
      this.statusValue !==
      "active"
    ) {
      throw new QuestGoalError(
        "invalid-transition",
        `QuestGoal só pode ser completado a partir de "active"; estado atual: "${this.statusValue}".`,
      );
    }

    this.progressValue =
      this.requiredProgress;

    this.statusValue =
      "completed";
  }

  public fail(): void {
    if (
      this.statusValue !==
      "active"
    ) {
      throw new QuestGoalError(
        "invalid-transition",
        `QuestGoal só pode falhar a partir de "active"; estado atual: "${this.statusValue}".`,
      );
    }

    this.statusValue =
      "failed";
  }

  public toSnapshot():
    QuestGoalSnapshot {
    return {
      id: this.id,
      kindId:
        this.kindId,
      targetId:
        this.targetId,
      requiredProgress:
        this.requiredProgress,
      progress:
        this.progressValue,
      status:
        this.statusValue,
    };
  }
}
