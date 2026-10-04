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
  QuestGoal,
  QuestGoalError,
} from "../src/domain/narrative";

function createGoal():
  QuestGoal {
  return new QuestGoal({
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
  });
}

describe(
  "Etapa 44.4 — QuestGoal",
  () => {
    it(
      "executa inactive -> active -> completed por progresso",
      () => {
        const goal =
          createGoal();

        expect(
          goal.status,
        ).toBe("inactive");

        goal.activate();

        expect(
          goal.advance(1),
        ).toBe(1);

        expect(
          goal.progress,
        ).toBe(1);

        expect(
          goal.remainingProgress,
        ).toBe(2);

        expect(
          goal.advance(50),
        ).toBe(2);

        expect(
          goal.status,
        ).toBe("completed");

        expect(
          goal.progress,
        ).toBe(3);

        expect(
          goal.isTerminal,
        ).toBe(true);
      },
    );

    it(
      "permite complete explícito",
      () => {
        const goal =
          createGoal();

        goal.activate();
        goal.complete();

        expect(
          goal.progress,
        ).toBe(3);

        expect(
          goal.status,
        ).toBe("completed");
      },
    );

    it(
      "permite falha após progresso parcial",
      () => {
        const goal =
          createGoal();

        goal.activate();
        goal.advance(1);
        goal.fail();

        expect(
          goal.status,
        ).toBe("failed");

        expect(
          goal.progress,
        ).toBe(1);

        expect(
          goal.isTerminal,
        ).toBe(true);
      },
    );

    it(
      "impede transições inválidas",
      () => {
        const goal =
          createGoal();

        expect(() =>
          goal.advance(),
        ).toThrow(
          QuestGoalError,
        );

        expect(() =>
          goal.fail(),
        ).toThrow(
          QuestGoalError,
        );

        goal.activate();

        expect(() =>
          goal.activate(),
        ).toThrow(
          QuestGoalError,
        );

        goal.complete();

        expect(() =>
          goal.advance(),
        ).toThrow(
          QuestGoalError,
        );
      },
    );

    it(
      "reconstrói snapshot válido",
      () => {
        const original =
          createGoal();

        original.activate();
        original.advance(2);

        const snapshot =
          original.toSnapshot();

        const restored =
          QuestGoal.fromSnapshot(
            snapshot,
          );

        expect(
          restored.toSnapshot(),
        ).toEqual(snapshot);

        expect(
          restored.status,
        ).toBe("active");

        expect(
          restored.progress,
        ).toBe(2);
      },
    );

    it(
      "rejeita snapshot inconsistente",
      () => {
        expect(() =>
          QuestGoal.fromSnapshot({
            id:
              createQuestGoalId(
                "goal.bad",
              ),
            kindId:
              createQuestGoalKindId(
                "goal-kind.bad",
              ),
            targetId: null,
            requiredProgress: 3,
            progress: 3,
            status: "active",
          }),
        ).toThrow(
          QuestGoalError,
        );

        expect(() =>
          new QuestGoal({
            id:
              createQuestGoalId(
                "goal.invalid",
              ),
            kindId:
              createQuestGoalKindId(
                "goal-kind.invalid",
              ),
            requiredProgress: 0,
          }),
        ).toThrow(
          QuestGoalError,
        );
      },
    );

    it(
      "mantém target como referência lógica sem dimensão",
      () => {
        const goal =
          createGoal();

        const snapshot =
          goal.toSnapshot();

        expect(snapshot).toEqual({
          id: "goal.collect",
          kindId:
            "goal-kind.collect",
          targetId:
            "target.crystal",
          requiredProgress: 3,
          progress: 0,
          status: "inactive",
        });

        expect(
          Object.keys(snapshot),
        ).not.toEqual(
          expect.arrayContaining([
            "x",
            "y",
            "z",
            "position",
            "area",
            "collider",
            "mesh",
            "sprite",
          ]),
        );
      },
    );
  },
);
