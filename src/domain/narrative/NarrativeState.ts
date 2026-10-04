import type {
  QuestDefinition,
} from "./QuestDefinition";

import type {
  QuestGoalId,
} from "./QuestGoal";

import {
  createQuestId,
} from "./QuestId";

import type {
  QuestId,
} from "./QuestId";

import {
  QuestState,
} from "./QuestState";

import type {
  QuestStateSnapshot,
} from "./QuestState";

import {
  StoryFlagSet,
} from "./StoryFlagSet";

import type {
  StoryFlagId,
  StoryFlagSetSnapshot,
} from "./StoryFlagSet";

export interface NarrativeStateSnapshot {
  readonly quests:
    readonly QuestStateSnapshot[];
  readonly storyFlags:
    StoryFlagSetSnapshot;
}

export type NarrativeStateErrorCode =
  | "duplicate-quest"
  | "unknown-quest"
  | "definition-mismatch"
  | "invalid-snapshot";

export class NarrativeStateError
  extends Error {
  public readonly name =
    "NarrativeStateError";

  public constructor(
    public readonly code:
      NarrativeStateErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function compareQuestId(
  left:
    QuestId,
  right:
    QuestId,
): number {
  return left < right
    ? -1
    : left > right
      ? 1
      : 0;
}

/**
 * Agregado runtime mínimo de narrativa.
 *
 * Mantém QuestStates e StoryFlagSet, sem publicar eventos ou alterar outros
 * subdomínios automaticamente.
 */
export class NarrativeState {
  private readonly quests =
    new Map<
      QuestId,
      QuestState
    >();

  private storyFlagsValue:
    StoryFlagSet;

  public constructor(
    definitions:
      readonly QuestDefinition[] =
        [],
    storyFlags:
      StoryFlagSet =
        new StoryFlagSet(),
  ) {
    for (
      const definition of
      definitions
    ) {
      if (
        this.quests.has(
          definition.id,
        )
      ) {
        throw new NarrativeStateError(
          "duplicate-quest",
          `QuestId duplicado: "${definition.id}".`,
        );
      }

      this.quests.set(
        definition.id,
        new QuestState(
          definition,
        ),
      );
    }

    this.storyFlagsValue =
      storyFlags;
  }

  public static fromSnapshot(
    definitions:
      readonly QuestDefinition[],
    snapshot:
      NarrativeStateSnapshot,
  ): NarrativeState {
    const definitionsById =
      new Map<
        QuestId,
        QuestDefinition
      >();

    for (
      const definition of
      definitions
    ) {
      if (
        definitionsById.has(
          definition.id,
        )
      ) {
        throw new NarrativeStateError(
          "duplicate-quest",
          `QuestDefinition duplicada: "${definition.id}".`,
        );
      }

      definitionsById.set(
        definition.id,
        definition,
      );
    }

    if (
      snapshot.quests.length !==
      definitionsById.size
    ) {
      throw new NarrativeStateError(
        "definition-mismatch",
        "Quantidade de QuestStates no snapshot difere das QuestDefinitions fornecidas.",
      );
    }

    let storyFlags:
      StoryFlagSet;

    try {
      storyFlags =
        StoryFlagSet.fromSnapshot(
          snapshot.storyFlags,
        );
    } catch (error) {
      throw new NarrativeStateError(
        "invalid-snapshot",
        `StoryFlagSetSnapshot inválido: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );
    }

    const state =
      new NarrativeState(
        [],
        storyFlags,
      );

    for (
      const questSnapshot of
      snapshot.quests
    ) {
      let questId:
        QuestId;

      try {
        questId =
          createQuestId(
            questSnapshot
              .questId,
          );
      } catch (error) {
        throw new NarrativeStateError(
          "invalid-snapshot",
          `QuestId inválido no NarrativeStateSnapshot: ${
            error instanceof Error
              ? error.message
              : String(error)
          }`,
        );
      }

      if (
        state.quests.has(
          questId,
        )
      ) {
        throw new NarrativeStateError(
          "duplicate-quest",
          `QuestState duplicado no snapshot: "${questId}".`,
        );
      }

      const definition =
        definitionsById.get(
          questId,
        );

      if (
        definition === undefined
      ) {
        throw new NarrativeStateError(
          "definition-mismatch",
          `QuestDefinition ausente para "${questId}".`,
        );
      }

      try {
        state.quests.set(
          questId,
          QuestState.fromSnapshot(
            definition,
            questSnapshot,
          ),
        );
      } catch (error) {
        throw new NarrativeStateError(
          "invalid-snapshot",
          `QuestStateSnapshot inválido para "${questId}": ${
            error instanceof Error
              ? error.message
              : String(error)
          }`,
        );
      }
    }

    return state;
  }

  public get questCount():
    number {
    return this.quests.size;
  }

  public get storyFlagCount():
    number {
    return this
      .storyFlagsValue
      .size;
  }

  public hasQuest(
    questId:
      QuestId,
  ): boolean {
    return this.quests.has(
      questId,
    );
  }

  public getQuest(
    questId:
      QuestId,
  ): QuestState {
    const quest =
      this.quests.get(
        questId,
      );

    if (
      quest === undefined
    ) {
      throw new NarrativeStateError(
        "unknown-quest",
        `Quest desconhecida: "${questId}".`,
      );
    }

    return quest;
  }

  public activateQuest(
    questId:
      QuestId,
  ): void {
    this.getQuest(
      questId,
    ).activate();
  }

  public advanceQuestGoal(
    questId:
      QuestId,
    goalId:
      QuestGoalId,
    amount:
      number = 1,
  ): number {
    return this
      .getQuest(
        questId,
      )
      .advanceGoal(
        goalId,
        amount,
      );
  }

  public completeQuestGoal(
    questId:
      QuestId,
    goalId:
      QuestGoalId,
  ): void {
    this
      .getQuest(
        questId,
      )
      .completeGoal(
        goalId,
      );
  }

  public failQuestGoal(
    questId:
      QuestId,
    goalId:
      QuestGoalId,
  ): void {
    this
      .getQuest(
        questId,
      )
      .failGoal(
        goalId,
      );
  }

  public failQuest(
    questId:
      QuestId,
  ): void {
    this
      .getQuest(
        questId,
      )
      .fail();
  }

  public hasStoryFlag(
    flagId:
      StoryFlagId,
  ): boolean {
    return this
      .storyFlagsValue
      .has(
        flagId,
      );
  }

  public setStoryFlag(
    flagId:
      StoryFlagId,
  ): boolean {
    return this
      .storyFlagsValue
      .set(
        flagId,
      );
  }

  public clearStoryFlag(
    flagId:
      StoryFlagId,
  ): boolean {
    return this
      .storyFlagsValue
      .clear(
        flagId,
      );
  }

  public toSnapshot():
    NarrativeStateSnapshot {
    const questIds =
      [...this.quests.keys()]
        .sort(
          compareQuestId,
        );

    const questSnapshots:
      QuestStateSnapshot[] =
        [];

    for (
      const questId of
      questIds
    ) {
      const quest =
        this.quests.get(
          questId,
        );

      if (
        quest === undefined
      ) {
        continue;
      }

      questSnapshots.push(
        quest.toSnapshot(),
      );
    }

    return Object.freeze({
      quests:
        Object.freeze(
          questSnapshots,
        ),
      storyFlags:
        this.storyFlagsValue
          .toSnapshot(),
    });
  }
}
