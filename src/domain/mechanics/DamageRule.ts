import {
  acceptGameplayRule,
  rejectGameplayRule,
} from "./GameplayRuleOutcome";

import type {
  GameplayRuleOutcome,
} from "./GameplayRuleOutcome";

export interface DamageRuleInput {
  readonly currentHealth:
    number;
  readonly incomingDamage:
    number;
  readonly flatMitigation?:
    number;
  readonly multiplier?:
    number;
}

export interface DamageRuleResult {
  readonly previousHealth:
    number;
  readonly requestedDamage:
    number;
  readonly effectiveDamage:
    number;
  readonly appliedDamage:
    number;
  readonly overkillDamage:
    number;
  readonly nextHealth:
    number;
  readonly lethal:
    boolean;
}

export type DamageRuleRejectionReason =
  "target-already-defeated";

export type DamageRuleOutcome =
  GameplayRuleOutcome<
    DamageRuleResult,
    DamageRuleRejectionReason
  >;

export type DamageRuleErrorCode =
  | "invalid-health"
  | "invalid-damage"
  | "invalid-mitigation"
  | "invalid-multiplier"
  | "non-finite-result";

export class DamageRuleError
  extends Error {
  public readonly name =
    "DamageRuleError";

  public constructor(
    public readonly code:
      DamageRuleErrorCode,
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
    | "invalid-damage"
    | "invalid-mitigation"
    | "invalid-multiplier",
): void {
  if (
    !Number.isFinite(value) ||
    value < 0
  ) {
    throw new DamageRuleError(
      code,
      `${label} deve ser finito e maior ou igual a zero.`,
    );
  }
}

/**
 * Cálculo puro de dano.
 *
 * Ordem:
 * 1. incomingDamage - flatMitigation, saturado em zero;
 * 2. multiplicador;
 * 3. saturação pela vida disponível.
 *
 * A regra não altera nenhuma entidade.
 */
export class DamageRule {
  public evaluate(
    input:
      DamageRuleInput,
  ): DamageRuleOutcome {
    assertFiniteNonNegative(
      input.currentHealth,
      "currentHealth",
      "invalid-health",
    );

    assertFiniteNonNegative(
      input.incomingDamage,
      "incomingDamage",
      "invalid-damage",
    );

    const flatMitigation =
      input.flatMitigation ??
      0;

    const multiplier =
      input.multiplier ??
      1;

    assertFiniteNonNegative(
      flatMitigation,
      "flatMitigation",
      "invalid-mitigation",
    );

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
        "target-already-defeated",
        null,
      );
    }

    const afterMitigation =
      Math.max(
        0,
        input.incomingDamage -
          flatMitigation,
      );

    const effectiveDamage =
      afterMitigation *
      multiplier;

    if (
      !Number.isFinite(
        effectiveDamage,
      )
    ) {
      throw new DamageRuleError(
        "non-finite-result",
        "DamageRule produziu effectiveDamage não finito.",
      );
    }

    const appliedDamage =
      Math.min(
        input.currentHealth,
        effectiveDamage,
      );

    const nextHealth =
      input.currentHealth -
      appliedDamage;

    const overkillDamage =
      Math.max(
        0,
        effectiveDamage -
          appliedDamage,
      );

    return acceptGameplayRule(
      Object.freeze({
        previousHealth:
          input.currentHealth,
        requestedDamage:
          input.incomingDamage,
        effectiveDamage,
        appliedDamage,
        overkillDamage,
        nextHealth,
        lethal:
          nextHealth === 0 &&
          appliedDamage > 0,
      }),
    );
  }
}

export const DEFAULT_DAMAGE_RULE =
  Object.freeze(
    new DamageRule(),
  );
