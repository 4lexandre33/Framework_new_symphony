export interface ProgressionCurveSnapshot {
  /**
   * XP total acumulado necessário para cada nível.
   *
   * Índice 0 = level 1.
   */
  readonly totalExperienceThresholds:
    readonly number[];
}

export type ProgressionCurveErrorCode =
  | "empty-curve"
  | "invalid-threshold"
  | "first-threshold-not-zero"
  | "non-increasing-threshold"
  | "invalid-level"
  | "invalid-experience"
  | "invalid-snapshot";

export class ProgressionCurveError
  extends Error {
  public readonly name =
    "ProgressionCurveError";

  public constructor(
    public readonly code:
      ProgressionCurveErrorCode,
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
    throw new ProgressionCurveError(
      "invalid-experience",
      "Experience deve ser inteiro seguro maior ou igual a zero.",
    );
  }
}

/**
 * Curva imutável baseada em thresholds cumulativos de XP.
 *
 * Exemplo:
 * [0, 100, 300, 600]
 *
 * level 1 = 0 XP
 * level 2 = 100 XP
 * level 3 = 300 XP
 * level 4 = 600 XP
 *
 * Lookup de level usa busca binária e não aloca.
 */
export class ProgressionCurve {
  private readonly thresholds:
    readonly number[];

  public constructor(
    totalExperienceThresholds:
      readonly number[],
  ) {
    if (
      totalExperienceThresholds.length ===
      0
    ) {
      throw new ProgressionCurveError(
        "empty-curve",
        "ProgressionCurve exige ao menos o threshold do level 1.",
      );
    }

    const copy =
      [...totalExperienceThresholds];

    for (
      let index = 0;
      index < copy.length;
      index += 1
    ) {
      const value =
        copy[index];

      if (
        value === undefined ||
        !Number.isSafeInteger(
          value,
        ) ||
        value < 0
      ) {
        throw new ProgressionCurveError(
          "invalid-threshold",
          `Threshold no índice ${String(index)} deve ser inteiro seguro >= 0.`,
        );
      }

      if (
        index === 0 &&
        value !== 0
      ) {
        throw new ProgressionCurveError(
          "first-threshold-not-zero",
          "O threshold do level 1 deve ser exatamente zero.",
        );
      }

      if (
        index > 0
      ) {
        const previous =
          copy[index - 1];

        if (
          previous === undefined ||
          value <= previous
        ) {
          throw new ProgressionCurveError(
            "non-increasing-threshold",
            "ProgressionCurve exige thresholds estritamente crescentes.",
          );
        }
      }
    }

    this.thresholds =
      Object.freeze(copy);
  }

  public static fromSnapshot(
    snapshot:
      ProgressionCurveSnapshot,
  ): ProgressionCurve {
    try {
      return new ProgressionCurve(
        snapshot
          .totalExperienceThresholds,
      );
    } catch (error) {
      throw new ProgressionCurveError(
        "invalid-snapshot",
        `ProgressionCurveSnapshot inválido: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );
    }
  }

  public get maxLevel():
    number {
    return this.thresholds.length;
  }

  public getRequiredTotalExperience(
    level: number,
  ): number {
    if (
      !Number.isSafeInteger(
        level,
      ) ||
      level < 1 ||
      level >
        this.maxLevel
    ) {
      throw new ProgressionCurveError(
        "invalid-level",
        `Level deve estar entre 1 e ${String(this.maxLevel)}.`,
      );
    }

    const value =
      this.thresholds[
        level - 1
      ];

    if (
      value === undefined
    ) {
      throw new ProgressionCurveError(
        "invalid-level",
        `Threshold inexistente para level ${String(level)}.`,
      );
    }

    return value;
  }

  /**
   * Retorna o maior level cujo threshold é <= totalExperience.
   */
  public getLevelForTotalExperience(
    totalExperience:
      number,
  ): number {
    assertExperience(
      totalExperience,
    );

    let low = 0;
    let high =
      this.thresholds.length -
      1;
    let answer = 0;

    while (low <= high) {
      const middle =
        Math.floor(
          (
            low +
            high
          ) /
          2,
        );

      const threshold =
        this.thresholds[
          middle
        ];

      if (
        threshold ===
        undefined
      ) {
        throw new ProgressionCurveError(
          "invalid-threshold",
          "ProgressionCurve contém índice inválido.",
        );
      }

      if (
        threshold <=
        totalExperience
      ) {
        answer = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    return answer + 1;
  }

  public getExperienceIntoLevel(
    totalExperience:
      number,
  ): number {
    const level =
      this.getLevelForTotalExperience(
        totalExperience,
      );

    const base =
      this.getRequiredTotalExperience(
        level,
      );

    return (
      totalExperience -
      base
    );
  }

  public getExperienceRequiredForNextLevel(
    totalExperience:
      number,
  ): number | null {
    const level =
      this.getLevelForTotalExperience(
        totalExperience,
      );

    if (
      level ===
      this.maxLevel
    ) {
      return null;
    }

    const currentThreshold =
      this.getRequiredTotalExperience(
        level,
      );

    const nextThreshold =
      this.getRequiredTotalExperience(
        level + 1,
      );

    return (
      nextThreshold -
      currentThreshold
    );
  }

  public getProgress01(
    totalExperience:
      number,
  ): number {
    const required =
      this.getExperienceRequiredForNextLevel(
        totalExperience,
      );

    if (
      required === null
    ) {
      return 1;
    }

    return (
      this.getExperienceIntoLevel(
        totalExperience,
      ) /
      required
    );
  }

  public toSnapshot():
    ProgressionCurveSnapshot {
    return Object.freeze({
      totalExperienceThresholds:
        this.thresholds,
    });
  }
}
