import type {
  ConditionDefinition,
  ConditionExpression,
} from "./ConditionExpression";

import {
  compareStateValues,
} from "./ComparisonOperator";

import type {
  ComparisonError,
  ComparisonOperator,
} from "./ComparisonOperator";

import {
  domainErr,
  domainOk,
} from "./DomainResult";

import type {
  DomainResult,
} from "./DomainResult";

import type {
  StateKey,
} from "../state/StateKey";

import type {
  StateStore,
} from "../state/StateStore";

export type ConditionEvaluationErrorCode =
  | "comparison-error";

export interface ConditionEvaluationError {
  readonly code:
    ConditionEvaluationErrorCode;
  readonly conditionId:
    string;
  readonly key:
    StateKey;
  readonly operator:
    ComparisonOperator;
  readonly comparison:
    ComparisonError;
}

export type ConditionEvaluationResult =
  DomainResult<
    boolean,
    ConditionEvaluationError
  >;

function comparisonFailure(
  conditionId: string,
  key: StateKey,
  operator:
    ComparisonOperator,
  comparison:
    ComparisonError,
): ConditionEvaluationResult {
  return domainErr({
    code:
      "comparison-error",
    conditionId,
    key,
    operator,
    comparison,
  });
}

function evaluateExpression(
  conditionId: string,
  expression:
    ConditionExpression,
  state:
    StateStore,
): ConditionEvaluationResult {
  switch (
    expression.kind
  ) {
    case "literal":
      return domainOk(
        expression.value,
      );

    case "state-exists":
      return domainOk(
        state.has(
          expression.key,
        ),
      );

    case "state-compare": {
      const current =
        state.read(
          expression.key,
        );

      /**
       * Ausência de fact é uma condição falsa, não um erro de configuração.
       * Para distinguir presença, use explicitamente state-exists.
       */
      if (
        current === undefined
      ) {
        return domainOk(false);
      }

      const comparison =
        compareStateValues(
          current,
          expression.value,
          expression.operator,
        );

      if (!comparison.ok) {
        return comparisonFailure(
          conditionId,
          expression.key,
          expression.operator,
          comparison.error,
        );
      }

      return comparison;
    }

    case "not": {
      const result =
        evaluateExpression(
          conditionId,
          expression.condition,
          state,
        );

      if (!result.ok) {
        return result;
      }

      return domainOk(
        !result.value,
      );
    }

    case "all": {
      for (
        const condition of
        expression.conditions
      ) {
        const result =
          evaluateExpression(
            conditionId,
            condition,
            state,
          );

        if (!result.ok) {
          return result;
        }

        if (!result.value) {
          return domainOk(
            false,
          );
        }
      }

      return domainOk(true);
    }

    case "any": {
      for (
        const condition of
        expression.conditions
      ) {
        const result =
          evaluateExpression(
            conditionId,
            condition,
            state,
          );

        if (!result.ok) {
          return result;
        }

        if (result.value) {
          return domainOk(
            true,
          );
        }
      }

      return domainOk(false);
    }
  }
}

/**
 * Avaliador puro de Conditions.
 *
 * O único contexto runtime é StateStore. Não executa scripts, callbacks,
 * services, engine queries, raycasts ou side effects.
 */
export class ConditionEvaluator {
  public evaluate(
    definition:
      ConditionDefinition,
    state:
      StateStore,
  ): ConditionEvaluationResult {
    return evaluateExpression(
      definition.id,
      definition.expression,
      state,
    );
  }
}
