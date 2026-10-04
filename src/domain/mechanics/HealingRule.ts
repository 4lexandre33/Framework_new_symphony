import {
  acceptGameplayRule,
  rejectGameplayRule,
} from "./GameplayRuleOutcome";

import type {
  GameplayRuleOutcome,
} from "./GameplayRuleOutcome";

export interface HealingRuleInput {
  readonly currentHealth:
    number;
  readonly maxHealth:
    number;
  readonly incomingHealing:
    number;
  readonly multiplier?:
    number;
}

export interface HealingRuleResult {
  readonly previousHealth:
    number;
  readonly maxHealth:
    number;
  readonly requestedHealing:
    number;
  readonly effectiveHealing:
    number;
  readonly appliedHealing:
    number;
  readonly wastedHealing:
    number;
  readonly nextHealth:
    number;
  readonly fullyRestored:
    boolean;
}

export type HealingRuleRejectionReason =
  "target-defeated";

export type HealingRuleOutcome =
  GameplayRuleOutcome<
    HealingRuleResult,
    HealingRuleRejectionReason
  >;

export type HealingRuleErrorCode =
  | "invalid-health"
  | "invalid-max-health"
  | "health-exceeds-max"
  | "invalid-healing"
  | "invalid-multiplier"
  | "non-finite-result";

export class HealingRuleError
  extends Error {
  public readonly name =
    "HealingRuleError";

  public constructor(
    public readonly code:
      HealingRuleErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function assertFiniteNonNegative(
  value: number,
  label: string,
  code:
    | "invalid-health"
    | "invalid-healing"
    | "invalid-multiplier",
): void {
  if (
    !Number.isFinite(value) ||
    value < 0
  ) {
    throw new HealingRuleError(
      code,
      `${label} deve ser finito e maior ou igual a zero.`,
    );
  }
}

/**
 * Cálculo puro de cura.
 *
 * Vida zero é rejeitada para preservar a distinção entre cura e revive.
 * A regra não altera nenhuma entidade.
 */
export class HealingRule {
  public evaluate(
    input:
      HealingRuleInput,
  ): HealingRuleOutcome {
    assertFiniteNonNegative(
      input.currentHealth,
      "currentHealth",
      "invalid-health",
    );

    if (
      !Number.isFinite(
        input.maxHealth,
      ) ||
      input.maxHealth <= 0
    ) {
      throw new HealingRuleError(
        "invalid-max-health",
        "maxHealth deve ser finito e maior que zero.",
      );
    }

    if (
      input.currentHealth >
      input.maxHealth
    ) {
      throw new HealingRuleError(
        "health-exceeds-max",
        "currentHealth não pode exceder maxHealth.",
      );
    }

    assertFiniteNonNegative(
      input.incomingHealing,
      "incomingHealing",
      "invalid-healing",
    );

    const multiplier =
      input.multiplier ??
      1;

    assertFiniteNonNegative(
      multiplier,
      "multiplier",
      "invalid-multiplier",
    );

    if (
      input.currentHealth ===
      0
    ) {
      return rejectGameplayRule(
        "target-defeated",
        null,
      );
    }

    const effectiveHealing =
      input.incomingHealing *
      multiplier;

    if (
      !Number.isFinite(
        effectiveHealing,
      )
    ) {
      throw new HealingRuleError(
        "non-finite-result",
        "HealingRule produziu effectiveHealing não finito.",
      );
    }

    const missingHealth =
      input.maxHealth -
      input.currentHealth;

    const appliedHealing =
      Math.min(
        missingHealth,
        effectiveHealing,
      );

    const nextHealth =
      input.currentHealth +
      appliedHealing;

    const wastedHealing =
      Math.max(
        0,
        effectiveHealing -
          appliedHealing,
      );

    return acceptGameplayRule(
      Object.freeze({
        previousHealth:
          input.currentHealth,
        maxHealth:
          input.maxHealth,
        requestedHealing:
          input.incomingHealing,
        effectiveHealing,
        appliedHealing,
        wastedHealing,
        nextHealth,
        fullyRestored:
          nextHealth ===
          input.maxHealth,
      }),
    );
  }
}

export const DEFAULT_HEALING_RULE =
  Object.freeze(
    new HealingRule(),
  );
