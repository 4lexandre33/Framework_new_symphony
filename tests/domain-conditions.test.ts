// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  compareStateValues,
  ConditionEvaluator,
  ConditionExpressionError,
  createAllCondition,
  createAnyCondition,
  createConditionDefinition,
  createConditionId,
  createLiteralCondition,
  createNotCondition,
  createStateCompareCondition,
  createStateExistsCondition,
} from "../src/domain/evaluation";

import {
  createStateKey,
  StateStore,
} from "../src/domain/state";

describe(
  "Etapa 50 — ComparisonOperator",
  () => {
    it(
      "compara igualdade estrutural",
      () => {
        const left = {
          active: true,
          values: [
            1,
            2,
          ],
        };

        const right = {
          values: [
            1,
            2,
          ],
          active: true,
        };

        expect(
          compareStateValues(
            left,
            right,
            "equals",
          ),
        ).toEqual({
          ok: true,
          value: true,
        });

        expect(
          compareStateValues(
            left,
            right,
            "not-equals",
          ),
        ).toEqual({
          ok: true,
          value: false,
        });
      },
    );

    it(
      "faz ordering somente entre numbers",
      () => {
        expect(
          compareStateValues(
            10,
            5,
            "greater-than",
          ),
        ).toEqual({
          ok: true,
          value: true,
        });

        const invalid =
          compareStateValues(
            "10",
            5,
            "greater-than",
          );

        expect(
          invalid.ok,
        ).toBe(false);

        if (!invalid.ok) {
          expect(
            invalid.error.code,
          ).toBe(
            "incompatible-operands",
          );
        }
      },
    );

    it(
      "contains suporta string e array por igualdade estrutural",
      () => {
        expect(
          compareStateValues(
            "castle-door",
            "door",
            "contains",
          ),
        ).toEqual({
          ok: true,
          value: true,
        });

        expect(
          compareStateValues(
            [
              "quest",
              {
                id: "boss",
              },
            ],
            {
              id: "boss",
            },
            "contains",
          ),
        ).toEqual({
          ok: true,
          value: true,
        });
      },
    );
  },
);

describe(
  "Etapa 50 — ConditionExpression",
  () => {
    it(
      "cria e congela definição completa",
      () => {
        const openKey =
          createStateKey<boolean>(
            "door.castle.open",
          );

        const expression =
          createAllCondition([
            createStateExistsCondition(
              openKey,
            ),
            createStateCompareCondition(
              openKey,
              "equals",
              true,
            ),
          ]);

        const definition =
          createConditionDefinition(
            createConditionId(
              "condition.castle-door-open",
            ),
            expression,
          );

        expect(
          Object.isFrozen(
            definition,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            definition.expression,
          ),
        ).toBe(true);

        if (
          definition.expression
            .kind === "all"
        ) {
          expect(
            Object.isFrozen(
              definition.expression
                .conditions,
            ),
          ).toBe(true);
        }
      },
    );

    it(
      "rejeita all/any vazios",
      () => {
        expect(() =>
          createAllCondition(
            [],
          ),
        ).toThrow(
          ConditionExpressionError,
        );

        expect(() =>
          createAnyCondition(
            [],
          ),
        ).toThrow(
          ConditionExpressionError,
        );
      },
    );

    it(
      "rejeita árvore cíclica criada manualmente",
      () => {
        type MutableNot = {
          kind: "not";
          condition:
            unknown;
        };

        const cyclic:
          MutableNot = {
            kind: "not",
            condition: undefined,
          };

        cyclic.condition =
          cyclic;

        expect(() =>
          createConditionDefinition(
            createConditionId(
              "condition.cyclic",
            ),
            cyclic as never,
          ),
        ).toThrow(
          ConditionExpressionError,
        );
      },
    );
  },
);

describe(
  "Etapa 50 — ConditionEvaluator",
  () => {
    it(
      "avalia state-exists e state-compare",
      () => {
        const store =
          new StateStore();

        const powerKey =
          createStateKey<boolean>(
            "village.power.restored",
          );

        store.set(
          powerKey,
          true,
        );

        const definition =
          createConditionDefinition(
            createConditionId(
              "condition.power-restored",
            ),
            createAllCondition([
              createStateExistsCondition(
                powerKey,
              ),
              createStateCompareCondition(
                powerKey,
                "equals",
                true,
              ),
            ]),
          );

        const evaluator =
          new ConditionEvaluator();

        expect(
          evaluator.evaluate(
            definition,
            store,
          ),
        ).toEqual({
          ok: true,
          value: true,
        });
      },
    );

    it(
      "state-compare ausente resulta false e state-exists distingue ausência",
      () => {
        const store =
          new StateStore();

        const key =
          createStateKey<number>(
            "player.level",
          );

        const evaluator =
          new ConditionEvaluator();

        const compare =
          createConditionDefinition(
            createConditionId(
              "condition.level",
            ),
            createStateCompareCondition(
              key,
              "greater-or-equal",
              10,
            ),
          );

        const exists =
          createConditionDefinition(
            createConditionId(
              "condition.level-exists",
            ),
            createStateExistsCondition(
              key,
            ),
          );

        expect(
          evaluator.evaluate(
            compare,
            store,
          ),
        ).toEqual({
          ok: true,
          value: false,
        });

        expect(
          evaluator.evaluate(
            exists,
            store,
          ),
        ).toEqual({
          ok: true,
          value: false,
        });
      },
    );

    it(
      "avalia all/any/not/literal com short-circuit lógico",
      () => {
        const store =
          new StateStore();

        const evaluator =
          new ConditionEvaluator();

        const definition =
          createConditionDefinition(
            createConditionId(
              "condition.logic",
            ),
            createAllCondition([
              createLiteralCondition(
                true,
              ),
              createAnyCondition([
                createLiteralCondition(
                  false,
                ),
                createNotCondition(
                  createLiteralCondition(
                    false,
                  ),
                ),
              ]),
            ]),
          );

        expect(
          evaluator.evaluate(
            definition,
            store,
          ),
        ).toEqual({
          ok: true,
          value: true,
        });
      },
    );

    it(
      "retorna erro explícito para comparação incompatível",
      () => {
        const store =
          new StateStore();

        const key =
          createStateKey<string>(
            "player.rank",
          );

        store.set(
          key,
          "gold",
        );

        const definition =
          createConditionDefinition(
            createConditionId(
              "condition.invalid-comparison",
            ),
            createStateCompareCondition(
              key,
              "greater-than",
              "silver",
            ),
          );

        const result =
          new ConditionEvaluator()
            .evaluate(
              definition,
              store,
            );

        expect(
          result.ok,
        ).toBe(false);

        if (!result.ok) {
          expect(
            result.error.code,
          ).toBe(
            "comparison-error",
          );

          expect(
            result.error.key,
          ).toBe(
            "player.rank",
          );

          expect(
            result.error.comparison
              .code,
          ).toBe(
            "incompatible-operands",
          );
        }
      },
    );

    it(
      "contains permite condições sobre arrays de StateValue sem TagSet antecipado",
      () => {
        const store =
          new StateStore();

        const accessKey =
          createStateKey<
            readonly string[]
          >(
            "player.access",
          );

        store.set(
          accessKey,
          [
            "castle",
            "guild",
          ],
        );

        const definition =
          createConditionDefinition(
            createConditionId(
              "condition.has-castle-access",
            ),
            createStateCompareCondition(
              accessKey,
              "contains",
              "castle",
            ),
          );

        expect(
          new ConditionEvaluator()
            .evaluate(
              definition,
              store,
            ),
        ).toEqual({
          ok: true,
          value: true,
        });
      },
    );

    it(
      "é determinístico para mesma definição e mesmo StateStore",
      () => {
        const store =
          new StateStore();

        const key =
          createStateKey<number>(
            "quest.progress",
          );

        store.set(
          key,
          7,
        );

        const definition =
          createConditionDefinition(
            createConditionId(
              "condition.quest-progress",
            ),
            createStateCompareCondition(
              key,
              "greater-or-equal",
              5,
            ),
          );

        const evaluator =
          new ConditionEvaluator();

        const first =
          evaluator.evaluate(
            definition,
            store,
          );

        const second =
          evaluator.evaluate(
            definition,
            store,
          );

        expect(second).toEqual(
          first,
        );
      },
    );
  },
);
