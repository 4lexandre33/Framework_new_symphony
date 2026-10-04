import type {
  ConditionId,
} from "./ConditionId";

import type {
  ComparisonOperator,
} from "./ComparisonOperator";

import type {
  StateKey,
} from "../state/StateKey";

import {
  cloneStateValue,
} from "../state/StateValue";

import type {
  StateValue,
} from "../state/StateValue";

export interface LiteralConditionExpression {
  readonly kind:
    "literal";
  readonly value:
    boolean;
}

export interface StateExistsConditionExpression {
  readonly kind:
    "state-exists";
  readonly key:
    StateKey;
}

export interface StateCompareConditionExpression {
  readonly kind:
    "state-compare";
  readonly key:
    StateKey;
  readonly operator:
    ComparisonOperator;
  readonly value:
    StateValue;
}

export interface AllConditionExpression {
  readonly kind:
    "all";
  readonly conditions:
    readonly ConditionExpression[];
}

export interface AnyConditionExpression {
  readonly kind:
    "any";
  readonly conditions:
    readonly ConditionExpression[];
}

export interface NotConditionExpression {
  readonly kind:
    "not";
  readonly condition:
    ConditionExpression;
}

export type ConditionExpression =
  | LiteralConditionExpression
  | StateExistsConditionExpression
  | StateCompareConditionExpression
  | AllConditionExpression
  | AnyConditionExpression
  | NotConditionExpression;

export interface ConditionDefinition {
  readonly id:
    ConditionId;
  readonly expression:
    ConditionExpression;
}

export type ConditionExpressionErrorCode =
  | "empty-group"
  | "cyclic-expression"
  | "max-depth-exceeded";

export class ConditionExpressionError
  extends Error {
  public readonly name =
    "ConditionExpressionError";

  public constructor(
    public readonly code:
      ConditionExpressionErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const MAX_CONDITION_DEPTH =
  128;

function cloneExpression(
  expression:
    ConditionExpression,
  stack:
    Set<object>,
  depth: number,
): ConditionExpression {
  if (
    depth >
    MAX_CONDITION_DEPTH
  ) {
    throw new ConditionExpressionError(
      "max-depth-exceeded",
      `ConditionExpression excedeu profundidade máxima de ${String(MAX_CONDITION_DEPTH)}.`,
    );
  }

  if (
    stack.has(
      expression,
    )
  ) {
    throw new ConditionExpressionError(
      "cyclic-expression",
      "ConditionExpression não pode conter referência cíclica.",
    );
  }

  stack.add(expression);

  try {
    switch (
      expression.kind
    ) {
      case "literal":
        return Object.freeze({
          kind: "literal",
          value:
            expression.value,
        });

      case "state-exists":
        return Object.freeze({
          kind:
            "state-exists",
          key: expression.key,
        });

      case "state-compare":
        return Object.freeze({
          kind:
            "state-compare",
          key: expression.key,
          operator:
            expression.operator,
          value:
            cloneStateValue(
              expression.value,
            ),
        });

      case "not":
        return Object.freeze({
          kind: "not",
          condition:
            cloneExpression(
              expression.condition,
              stack,
              depth + 1,
            ),
        });

      case "all":
      case "any": {
        if (
          expression.conditions
            .length === 0
        ) {
          throw new ConditionExpressionError(
            "empty-group",
            `ConditionExpression "${expression.kind}" precisa conter ao menos uma condição.`,
          );
        }

        const conditions =
          expression.conditions
            .map(
              (condition) =>
                cloneExpression(
                  condition,
                  stack,
                  depth + 1,
                ),
            );

        return Object.freeze({
          kind:
            expression.kind,
          conditions:
            Object.freeze(
              conditions,
            ),
        });
      }
    }
  } finally {
    stack.delete(
      expression,
    );
  }
}

/**
 * Valida e congela profundamente uma árvore de condições.
 *
 * A definição resultante é dado puro, serializável e não contém closures.
 */
export function createConditionDefinition(
  id: ConditionId,
  expression:
    ConditionExpression,
): ConditionDefinition {
  const cloned =
    cloneExpression(
      expression,
      new Set<object>(),
      0,
    );

  return Object.freeze({
    id,
    expression: cloned,
  });
}

export function createLiteralCondition(
  value: boolean,
): LiteralConditionExpression {
  return Object.freeze({
    kind: "literal",
    value,
  });
}

export function createStateExistsCondition(
  key: StateKey,
): StateExistsConditionExpression {
  return Object.freeze({
    kind: "state-exists",
    key,
  });
}

export function createStateCompareCondition(
  key: StateKey,
  operator:
    ComparisonOperator,
  value: StateValue,
): StateCompareConditionExpression {
  return Object.freeze({
    kind: "state-compare",
    key,
    operator,
    value:
      cloneStateValue(value),
  });
}

export function createAllCondition(
  conditions:
    readonly ConditionExpression[],
): AllConditionExpression {
  if (
    conditions.length === 0
  ) {
    throw new ConditionExpressionError(
      "empty-group",
      "createAllCondition exige ao menos uma condição.",
    );
  }

  return Object.freeze({
    kind: "all",
    conditions:
      Object.freeze(
        [...conditions],
      ),
  });
}

export function createAnyCondition(
  conditions:
    readonly ConditionExpression[],
): AnyConditionExpression {
  if (
    conditions.length === 0
  ) {
    throw new ConditionExpressionError(
      "empty-group",
      "createAnyCondition exige ao menos uma condição.",
    );
  }

  return Object.freeze({
    kind: "any",
    conditions:
      Object.freeze(
        [...conditions],
      ),
  });
}

export function createNotCondition(
  condition:
    ConditionExpression,
): NotConditionExpression {
  return Object.freeze({
    kind: "not",
    condition,
  });
}
