import {
  ConditionEvaluator,
  domainErr,
  domainOk,
} from "../evaluation";

import type {
  ConditionDefinition,
  ConditionEvaluationError,
  DomainResult,
} from "../evaluation";

import type {
  StateStore,
} from "../state";

export interface ConditionStateResolution {
  readonly conditionId:
    string;
  readonly satisfied:
    boolean;
}

export interface ConditionStateIntegrationError {
  readonly code:
    "condition-evaluation-error";
  readonly conditionId:
    string;
  readonly evaluation:
    ConditionEvaluationError;
}

export type ConditionStateIntegrationResult =
  DomainResult<
    readonly ConditionStateResolution[],
    ConditionStateIntegrationError
  >;

export type ConditionStateIntegrationErrorCode =
  "duplicate-condition";

export class ConditionStateIntegrationStructuralError
  extends Error {
  public readonly name =
    "ConditionStateIntegrationStructuralError";

  public constructor(
    public readonly code:
      ConditionStateIntegrationErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const DEFAULT_CONDITION_EVALUATOR =
  Object.freeze(
    new ConditionEvaluator(),
  );

/**
 * Avalia uma lista de Conditions contra um StateStore.
 *
 * A ordem de saída é a ordem declarada de entrada; o chamador controla essa
 * ordem. Nenhum state é alterado.
 */
export function resolveConditionsFromState(
  definitions:
    readonly ConditionDefinition[],
  state:
    StateStore,
  evaluator:
    ConditionEvaluator =
      DEFAULT_CONDITION_EVALUATOR,
): ConditionStateIntegrationResult {
  const seen =
    new Set<string>();

  const resolutions:
    ConditionStateResolution[] =
      [];

  for (
    const definition of
    definitions
  ) {
    if (
      seen.has(
        definition.id,
      )
    ) {
      throw new ConditionStateIntegrationStructuralError(
        "duplicate-condition",
        `ConditionId duplicado na integração: "${definition.id}".`,
      );
    }

    seen.add(
      definition.id,
    );

    const result =
      evaluator.evaluate(
        definition,
        state,
      );

    if (!result.ok) {
      return domainErr(
        Object.freeze({
          code:
            "condition-evaluation-error",
          conditionId:
            definition.id,
          evaluation:
            result.error,
        }),
      );
    }

    resolutions.push(
      Object.freeze({
        conditionId:
          definition.id,
        satisfied:
          result.value,
      }),
    );
  }

  return domainOk(
    Object.freeze(
      resolutions,
    ),
  );
}
