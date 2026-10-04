export interface ExperiencePoolSnapshot {
  readonly totalExperience:
    number;
}

export type ExperiencePoolErrorCode =
  | "invalid-experience"
  | "experience-overflow"
  | "invalid-snapshot";

export class ExperiencePoolError
  extends Error {
  public readonly name =
    "ExperiencePoolError";

  public constructor(
    public readonly code:
      ExperiencePoolErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function assertExperience(
  value: number,
): void {
  if (
    !Number.isSafeInteger(
      value,
    ) ||
    value < 0
  ) {
    throw new ExperiencePoolError(
      "invalid-experience",
      "Experience deve ser inteiro seguro maior ou igual a zero.",
    );
  }
}

/**
 * Pool cumulativo de experiência.
 *
 * Não calcula level e não conhece Agent. Ele mantém apenas XP total válido.
 */
export class ExperiencePool {
  private totalExperienceValue:
    number;

  public constructor(
    totalExperience:
      number = 0,
  ) {
    assertExperience(
      totalExperience,
    );

    this.totalExperienceValue =
      totalExperience;
  }

  public static fromSnapshot(
    snapshot:
      ExperiencePoolSnapshot,
  ): ExperiencePool {
    try {
      return new ExperiencePool(
        snapshot
          .totalExperience,
      );
    } catch (error) {
      throw new ExperiencePoolError(
        "invalid-snapshot",
        `ExperiencePoolSnapshot inválido: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );
    }
  }

  public get totalExperience():
    number {
    return this
      .totalExperienceValue;
  }

  /**
   * Adiciona XP de forma estrita e retorna o novo total.
   *
   * amount = 0 é permitido como no-op determinístico.
   */
  public add(
    amount: number,
  ): number {
    assertExperience(amount);

    if (amount === 0) {
      return this
        .totalExperienceValue;
    }

    const next =
      this.totalExperienceValue +
      amount;

    if (
      !Number.isSafeInteger(
        next,
      )
    ) {
      throw new ExperiencePoolError(
        "experience-overflow",
        "ExperiencePool excedeu o limite de inteiro seguro.",
      );
    }

    this.totalExperienceValue =
      next;

    return next;
  }

  /**
   * Setter estrito para restauração/autoria controlada.
   */
  public setTotalExperience(
    value: number,
  ): void {
    assertExperience(value);

    this.totalExperienceValue =
      value;
  }

  public toSnapshot():
    ExperiencePoolSnapshot {
    return Object.freeze({
      totalExperience:
        this
          .totalExperienceValue,
    });
  }
}
