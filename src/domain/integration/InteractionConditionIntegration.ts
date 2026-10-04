import type {
  ConditionDefinition,
  ConditionEvaluationError,
  DomainResult,
} from "../evaluation";

import {
  ConditionEvaluator,
  domainErr,
  domainOk,
} from "../evaluation";

import type {
  Affordance,
  InteractionIntent,
  InteractionOutcome,
  InteractionRequirementId,
} from "../interaction";

import {
  createInteractionRequirementResolution,
  resolveInteractionOutcome,
} from "../interaction";

import type {
  StateStore,
} from "../state";

export interface InteractionConditionBinding {
  readonly requirementId:
    InteractionRequirementId;
  readonly condition:
    ConditionDefinition;
}

export type InteractionConditionIntegrationErrorCode =
  | "duplicate-binding"
  | "unknown-binding";

export class InteractionConditionIntegrationStructuralError
  extends Error {
  public readonly name =
    "InteractionConditionIntegrationStructuralError";

  public constructor(
    public readonly code:
      InteractionConditionIntegrationErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface InteractionConditionEvaluationError {
  readonly code:
    | "missing-condition-binding"
    | "condition-evaluation-error";
  readonly requirementId:
    InteractionRequirementId;
  readonly conditionId:
    string | null;
  readonly evaluation:
    ConditionEvaluationError | null;
}

export type InteractionConditionIntegrationResult =
  DomainResult<
    InteractionOutcome,
    InteractionConditionEvaluationError
  >;

const DEFAULT_CONDITION_EVALUATOR =
  Object.freeze(
    new ConditionEvaluator(),
  );

/**
 * Resolve requirements de uma Affordance por ConditionDefinition + StateStore.
 *
 * A função somente autoriza/rejeita a interação. Ela não executa a ação.
 */
export function resolveInteractionWithConditions(
  intent:
    InteractionIntent,
  affordance:
    Affordance,
  bindings:
    readonly InteractionConditionBinding[],
  state:
    StateStore,
  evaluator:
    ConditionEvaluator =
      DEFAULT_CONDITION_EVALUATOR,
): InteractionConditionIntegrationResult {
  if (
    !affordance.supports(
      intent,
    )
  ) {
    return domainOk(
      resolveInteractionOutcome(
        intent,
        affordance,
      ),
    );
  }

  const bindingByRequirement =
    new Map<
      InteractionRequirementId,
      ConditionDefinition
    >();

  for (
    const binding of bindings
  ) {
    if (
      bindingByRequirement.has(
        binding.requirementId,
      )
    ) {
      throw new InteractionConditionIntegrationStructuralError(
        "duplicate-binding",
        `Binding duplicado para requirement "${binding.requirementId}".`,
      );
    }

    if (
      !affordance.hasRequirement(
        binding.requirementId,
      )
    ) {
      throw new InteractionConditionIntegrationStructuralError(
        "unknown-binding",
        `Binding aponta para requirement desconhecido "${binding.requirementId}".`,
      );
    }

    bindingByRequirement.set(
      binding.requirementId,
      binding.condition,
    );
  }

  const resolutions =
    [];

  for (
    const requirement of
    affordance.getRequirements()
  ) {
    const condition =
      bindingByRequirement.get(
        requirement.id,
      );

    if (
      condition === undefined
    ) {
      return domainErr(
        Object.freeze({
          code:
            "missing-condition-binding",
          requirementId:
            requirement.id,
          conditionId: null,
          evaluation: null,
        }),
      );
    }

    const result =
      evaluator.evaluate(
        condition,
        state,
      );

    if (!result.ok) {
      return domainErr(
        Object.freeze({
          code:
            "condition-evaluation-error",
          requirementId:
            requirement.id,
          conditionId:
            condition.id,
          evaluation:
            result.error,
        }),
      );
    }

    resolutions.push(
      createInteractionRequirementResolution(
        requirement.id,
        result.value,
      ),
    );
  }

  return domainOk(
    resolveInteractionOutcome(
      intent,
      affordance,
      resolutions,
    ),
  );
}
