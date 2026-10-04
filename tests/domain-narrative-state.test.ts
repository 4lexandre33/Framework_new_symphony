// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createQuestGoalId,
  createQuestGoalKindId,
  createQuestGoalTargetId,
  createQuestId,
  createStoryFlagId,
  NarrativeState,
  NarrativeStateError,
  QuestDefinition,
  QuestDefinitionError,
  QuestState,
  QuestStateError,
  StoryFlagSet,
  StoryFlagSetError,
} from "../src/domain/narrative";

function createQuestDefinition() {
  return new QuestDefinition({
    id:
      createQuestId(
        "quest.first-contract",
      ),
    title:
      "Primeiro Contrato",
    description:
      "Complete os objetivos do contrato.",
    goals: [
      {
        id:
          createQuestGoalId(
            "goal.collect",
          ),
        kindId:
          createQuestGoalKindId(
            "goal-kind.collect",
          ),
        targetId:
          createQuestGoalTargetId(
            "target.crystal",
          ),
        requiredProgress: 3,
      },
      {
        id:
          createQuestGoalId(
            "goal.report",
          ),
        kindId:
          createQuestGoalKindId(
            "goal-kind.report",
          ),
        requiredProgress: 1,
      },
    ],
  });
}

describe(
  "Etapa 58 — QuestDefinition",
  () => {
    it(
      "normaliza múltiplos goals em ordem determinística",
      () => {
        const definition =
          createQuestDefinition();

        expect(
          definition.goalCount,
        ).toBe(2);

        expect(
          definition
            .getGoals()
            .map(
              (goal) =>
                goal.id,
            ),
        ).toEqual([
          "goal.collect",
          "goal.report",
        ]);
      },
    );

    it(
      "rejeita definição sem goals e goal duplicado",
      () => {
        expect(() =>
          new QuestDefinition({
            id:
              createQuestId(
                "quest.empty",
              ),
            title: "Empty",
            goals: [],
          }),
        ).toThrow(
          QuestDefinitionError,
        );

        const goalId =
          createQuestGoalId(
            "goal.same",
          );

        expect(() =>
          new QuestDefinition({
            id:
              createQuestId(
                "quest.duplicate",
              ),
            title:
              "Duplicate",
            goals: [
              {
                id: goalId,
                kindId:
                  createQuestGoalKindId(
                    "goal-kind.a",
                  ),
              },
              {
                id: goalId,
                kindId:
                  createQuestGoalKindId(
                    "goal-kind.b",
                  ),
              },
            ],
          }),
        ).toThrow(
          QuestDefinitionError,
        );
      },
    );
  },
);

describe(
  "Etapa 58 — QuestState",
  () => {
    it(
      "activate inicia todos os goals",
      () => {
        const state =
          new QuestState(
            createQuestDefinition(),
          );

        state.activate();

        expect(
          state.status,
        ).toBe("active");

        expect(
          state.getGoal(
            createQuestGoalId(
              "goal.collect",
            ),
          ).status,
        ).toBe("active");

        expect(
          state.getGoal(
            createQuestGoalId(
              "goal.report",
            ),
          ).status,
        ).toBe("active");
      },
    );

    it(
      "completa quest somente quando todos os goals obrigatórios completam",
      () => {
        const state =
          new QuestState(
            createQuestDefinition(),
          );

        state.activate();

        expect(
          state.advanceGoal(
            createQuestGoalId(
              "goal.collect",
            ),
            10,
          ),
        ).toBe(3);

        expect(
          state.status,
        ).toBe("active");

        state.completeGoal(
          createQuestGoalId(
            "goal.report",
          ),
        );

        expect(
          state.status,
        ).toBe("completed");

        expect(
          state.isTerminal,
        ).toBe(true);
      },
    );

    it(
      "falhar um goal falha a quest e terminaliza goals ativos restantes",
      () => {
        const state =
          new QuestState(
            createQuestDefinition(),
          );

        state.activate();

        state.completeGoal(
          createQuestGoalId(
            "goal.collect",
          ),
        );

        state.failGoal(
          createQuestGoalId(
            "goal.report",
          ),
        );

        expect(
          state.status,
        ).toBe("failed");

        expect(
          state.getGoal(
            createQuestGoalId(
              "goal.collect",
            ),
          ).status,
        ).toBe("completed");

        expect(
          state.getGoal(
            createQuestGoalId(
              "goal.report",
            ),
          ).status,
        ).toBe("failed");
      },
    );

    it(
      "fail terminaliza todos os goals ainda ativos",
      () => {
        const state =
          new QuestState(
            createQuestDefinition(),
          );

        state.activate();
        state.fail();

        expect(
          state.status,
        ).toBe("failed");

        state.forEachGoal(
          (goal) => {
            expect(
              goal.status,
            ).toBe("failed");
          },
        );
      },
    );

    it(
      "snapshot round-trip valida a definição externa",
      () => {
        const definition =
          createQuestDefinition();

        const state =
          new QuestState(
            definition,
          );

        state.activate();

        state.advanceGoal(
          createQuestGoalId(
            "goal.collect",
          ),
          2,
        );

        const snapshot =
          state.toSnapshot();

        const restored =
          QuestState
            .fromSnapshot(
              definition,
              snapshot,
            );

        expect(
          restored.toSnapshot(),
        ).toEqual(snapshot);

        expect(
          restored.status,
        ).toBe("active");
      },
    );

    it(
      "restore rejeita definition mismatch",
      () => {
        const definition =
          createQuestDefinition();

        const state =
          new QuestState(
            definition,
          );

        const snapshot =
          state.toSnapshot();

        const other =
          new QuestDefinition({
            id:
              createQuestId(
                "quest.other",
              ),
            title: "Other",
            goals: [
              {
                id:
                  createQuestGoalId(
                    "goal.other",
                  ),
                kindId:
                  createQuestGoalKindId(
                    "goal-kind.other",
                  ),
              },
            ],
          });

        expect(() =>
          QuestState
            .fromSnapshot(
              other,
              snapshot,
            ),
        ).toThrow(
          QuestStateError,
        );
      },
    );
  },
);

describe(
  "Etapa 58 — StoryFlagSet",
  () => {
    it(
      "set/clear são idempotentes",
      () => {
        const flags =
          new StoryFlagSet();

        const flag =
          createStoryFlagId(
            "story.met-archivist",
          );

        expect(
          flags.set(flag),
        ).toBe(true);

        expect(
          flags.set(flag),
        ).toBe(false);

        expect(
          flags.has(flag),
        ).toBe(true);

        expect(
          flags.clear(flag),
        ).toBe(true);

        expect(
          flags.clear(flag),
        ).toBe(false);
      },
    );

    it(
      "snapshot ordena flags e round-trip preserva estado",
      () => {
        const flags =
          new StoryFlagSet([
            createStoryFlagId(
              "story.zeta",
            ),
            createStoryFlagId(
              "story.alpha",
            ),
          ]);

        const snapshot =
          flags.toSnapshot();

        expect(
          snapshot.flagIds,
        ).toEqual([
          "story.alpha",
          "story.zeta",
        ]);

        expect(
          StoryFlagSet
            .fromSnapshot(
              snapshot,
            )
            .toSnapshot(),
        ).toEqual(snapshot);
      },
    );

    it(
      "restore rejeita flag duplicada",
      () => {
        expect(() =>
          StoryFlagSet
            .fromSnapshot({
              flagIds: [
                "story.a",
                "story.a",
              ],
            }),
        ).toThrow(
          StoryFlagSetError,
        );
      },
    );
  },
);

describe(
  "Etapa 58 — NarrativeState",
  () => {
    it(
      "orquestra quests e flags somente dentro do domínio narrativo",
      () => {
        const definition =
          createQuestDefinition();

        const state =
          new NarrativeState([
            definition,
          ]);

        const flag =
          createStoryFlagId(
            "story.contract-known",
          );

        expect(
          state.setStoryFlag(
            flag,
          ),
        ).toBe(true);

        state.activateQuest(
          definition.id,
        );

        state.advanceQuestGoal(
          definition.id,
          createQuestGoalId(
            "goal.collect",
          ),
          3,
        );

        state.completeQuestGoal(
          definition.id,
          createQuestGoalId(
            "goal.report",
          ),
        );

        expect(
          state
            .getQuest(
              definition.id,
            )
            .status,
        ).toBe("completed");

        expect(
          state.hasStoryFlag(
            flag,
          ),
        ).toBe(true);
      },
    );

    it(
      "snapshot ordena quests e restaura com definitions externas",
      () => {
        const questB =
          new QuestDefinition({
            id:
              createQuestId(
                "quest.b",
              ),
            title: "B",
            goals: [
              {
                id:
                  createQuestGoalId(
                    "goal.b",
                  ),
                kindId:
                  createQuestGoalKindId(
                    "goal-kind.b",
                  ),
              },
            ],
          });

        const questA =
          new QuestDefinition({
            id:
              createQuestId(
                "quest.a",
              ),
            title: "A",
            goals: [
              {
                id:
                  createQuestGoalId(
                    "goal.a",
                  ),
                kindId:
                  createQuestGoalKindId(
                    "goal-kind.a",
                  ),
              },
            ],
          });

        const state =
          new NarrativeState([
            questB,
            questA,
          ]);

        state.setStoryFlag(
          createStoryFlagId(
            "story.ready",
          ),
        );

        const snapshot =
          state.toSnapshot();

        expect(
          snapshot.quests.map(
            (quest) =>
              quest.questId,
          ),
        ).toEqual([
          "quest.a",
          "quest.b",
        ]);

        const restored =
          NarrativeState
            .fromSnapshot(
              [
                questA,
                questB,
              ],
              snapshot,
            );

        expect(
          restored.toSnapshot(),
        ).toEqual(snapshot);
      },
    );

    it(
      "rejeita definitions duplicadas e snapshots incompletos",
      () => {
        const definition =
          createQuestDefinition();

        expect(() =>
          new NarrativeState([
            definition,
            definition,
          ]),
        ).toThrow(
          NarrativeStateError,
        );

        const state =
          new NarrativeState([
            definition,
          ]);

        const snapshot =
          state.toSnapshot();

        expect(() =>
          NarrativeState
            .fromSnapshot(
              [],
              snapshot,
            ),
        ).toThrow(
          NarrativeStateError,
        );
      },
    );
  },
);
