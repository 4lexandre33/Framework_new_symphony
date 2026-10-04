import type {
  LevelProgression,
  UnlockId,
  UnlockSet,
} from "../progression";

export interface LevelUnlockRule {
  readonly level:
    number;
  readonly unlockId:
    UnlockId;
}

export type ProgressionUnlockPlanErrorCode =
  | "invalid-level"
  | "duplicate-unlock";

export class ProgressionUnlockPlanError
  extends Error {
  public readonly name =
    "ProgressionUnlockPlanError";

  public constructor(
    public readonly code:
      ProgressionUnlockPlanErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function compareRule(
  left:
    LevelUnlockRule,
  right:
    LevelUnlockRule,
): number {
  if (
    left.level !==
    right.level
  ) {
    return (
      left.level -
      right.level
    );
  }

  return left.unlockId <
    right.unlockId
    ? -1
    : left.unlockId >
        right.unlockId
      ? 1
      : 0;
}

export class ProgressionUnlockPlan {
  private readonly rules:
    readonly LevelUnlockRule[];

  public constructor(
    rules:
      readonly LevelUnlockRule[],
  ) {
    const seen =
      new Set<UnlockId>();

    const copy:
      LevelUnlockRule[] =
        [];

    for (
      const rule of rules
    ) {
      if (
        !Number.isSafeInteger(
          rule.level,
        ) ||
        rule.level < 1
      ) {
        throw new ProgressionUnlockPlanError(
          "invalid-level",
          "LevelUnlockRule.level deve ser inteiro seguro >= 1.",
        );
      }

      if (
        seen.has(
          rule.unlockId,
        )
      ) {
        throw new ProgressionUnlockPlanError(
          "duplicate-unlock",
          `UnlockId duplicado no plan: "${rule.unlockId}".`,
        );
      }

      seen.add(
        rule.unlockId,
      );

      copy.push(
        Object.freeze({
          level:
            rule.level,
          unlockId:
            rule.unlockId,
        }),
      );
    }

    copy.sort(compareRule);

    this.rules =
      Object.freeze(copy);
  }

  public getRules():
    readonly LevelUnlockRule[] {
    return this.rules;
  }
}

export interface ProgressionUnlockApplyResult {
  readonly currentLevel:
    number;
  readonly newlyUnlocked:
    readonly UnlockId[];
  readonly alreadyUnlocked:
    readonly UnlockId[];
}

/**
 * Aplica ao UnlockSet todas as regras cujo level já foi alcançado.
 */
export function applyProgressionUnlocks(
  progression:
    LevelProgression,
  unlocks:
    UnlockSet,
  plan:
    ProgressionUnlockPlan,
): ProgressionUnlockApplyResult {
  const newlyUnlocked:
    UnlockId[] = [];

  const alreadyUnlocked:
    UnlockId[] = [];

  const currentLevel =
    progression.currentLevel;

  for (
    const rule of
    plan.getRules()
  ) {
    if (
      rule.level >
      currentLevel
    ) {
      break;
    }

    if (
      unlocks.unlock(
        rule.unlockId,
      )
    ) {
      newlyUnlocked.push(
        rule.unlockId,
      );
    } else {
      alreadyUnlocked.push(
        rule.unlockId,
      );
    }
  }

  return Object.freeze({
    currentLevel,
    newlyUnlocked:
      Object.freeze(
        newlyUnlocked,
      ),
    alreadyUnlocked:
      Object.freeze(
        alreadyUnlocked,
      ),
  });
}
