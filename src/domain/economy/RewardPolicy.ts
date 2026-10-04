export type RewardReplacementMode =
  | "with-replacement"
  | "without-replacement";

export interface RewardPolicyCreateOptions {
  readonly rolls?:
    number;
  readonly replacement?:
    RewardReplacementMode;
}

export interface RewardPolicySnapshot {
  readonly rolls:
    number;
  readonly replacement:
    RewardReplacementMode;
}

export type RewardPolicyErrorCode =
  | "invalid-rolls"
  | "invalid-replacement"
  | "invalid-snapshot";

export class RewardPolicyError
  extends Error {
  public readonly name =
    "RewardPolicyError";

  public constructor(
    public readonly code:
      RewardPolicyErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const MAX_REWARD_ROLLS =
  1_000_000;

function isReplacementMode(
  value: unknown,
): value is RewardReplacementMode {
  return (
    value ===
      "with-replacement" ||
    value ===
      "without-replacement"
  );
}

/**
 * Política de resolução de uma tabela de recompensas ponderadas.
 *
 * Não contém RNG e não executa grants.
 */
export class RewardPolicy {
  public readonly rolls:
    number;

  public readonly replacement:
    RewardReplacementMode;

  public constructor(
    options:
      RewardPolicyCreateOptions = {},
  ) {
    const rolls =
      options.rolls ?? 1;

    const replacement =
      options.replacement ??
      "with-replacement";

    if (
      !Number.isSafeInteger(
        rolls,
      ) ||
      rolls < 1 ||
      rolls >
        MAX_REWARD_ROLLS
    ) {
      throw new RewardPolicyError(
        "invalid-rolls",
        `RewardPolicy.rolls deve ser inteiro seguro entre 1 e ${String(MAX_REWARD_ROLLS)}.`,
      );
    }

    if (
      !isReplacementMode(
        replacement,
      )
    ) {
      throw new RewardPolicyError(
        "invalid-replacement",
        `RewardPolicy.replacement inválido: "${String(replacement)}".`,
      );
    }

    this.rolls = rolls;
    this.replacement =
      replacement;
  }

  public static fromSnapshot(
    snapshot:
      RewardPolicySnapshot,
  ): RewardPolicy {
    try {
      return new RewardPolicy({
        rolls: snapshot.rolls,
        replacement:
          snapshot.replacement,
      });
    } catch (error) {
      throw new RewardPolicyError(
        "invalid-snapshot",
        `RewardPolicySnapshot inválido: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );
    }
  }

  public toSnapshot():
    RewardPolicySnapshot {
    return Object.freeze({
      rolls: this.rolls,
      replacement:
        this.replacement,
    });
  }
}

export const DEFAULT_REWARD_POLICY =
  Object.freeze(
    new RewardPolicy(),
  );
