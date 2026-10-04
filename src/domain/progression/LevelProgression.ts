import {
  ExperiencePool,
} from "./ExperiencePool";

import type {
  ProgressionCurve,
} from "./ProgressionCurve";

export interface LevelProgressionSnapshot {
  readonly totalExperience:
    number;
}

export interface LevelProgressionChange {
  readonly previousLevel:
    number;
  readonly currentLevel:
    number;
  readonly levelsGained:
    number;
  readonly previousTotalExperience:
    number;
  readonly currentTotalExperience:
    number;
}

export type LevelProgressionErrorCode =
  | "invalid-snapshot";

export class LevelProgressionError
  extends Error {
  public readonly name =
    "LevelProgressionError";

  public constructor(
    public readonly code:
      LevelProgressionErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Projeção runtime de level derivada de XP total + ProgressionCurve.
 *
 * Não armazena level separadamente. Isso elimina drift entre level e XP.
 */
export class LevelProgression {
  private readonly experience:
    ExperiencePool;

  public constructor(
    private readonly curve:
      ProgressionCurve,
    totalExperience:
      number = 0,
  ) {
    this.experience =
      new ExperiencePool(
        totalExperience,
      );
  }

  public static fromSnapshot(
    curve:
      ProgressionCurve,
    snapshot:
      LevelProgressionSnapshot,
  ): LevelProgression {
    try {
      return new LevelProgression(
        curve,
        snapshot
          .totalExperience,
      );
    } catch (error) {
      throw new LevelProgressionError(
        "invalid-snapshot",
        `LevelProgressionSnapshot inválido: ${
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
      .experience
      .totalExperience;
  }

  public get currentLevel():
    number {
    return this
      .curve
      .getLevelForTotalExperience(
        this.totalExperience,
      );
  }

  public get maxLevel():
    number {
    return this.curve.maxLevel;
  }

  public get atMaxLevel():
    boolean {
    return (
      this.currentLevel ===
      this.maxLevel
    );
  }

  public get experienceIntoLevel():
    number {
    return this
      .curve
      .getExperienceIntoLevel(
        this.totalExperience,
      );
  }

  public get experienceRequiredForNextLevel():
    number | null {
    return this
      .curve
      .getExperienceRequiredForNextLevel(
        this.totalExperience,
      );
  }

  public get levelProgress01():
    number {
    return this
      .curve
      .getProgress01(
        this.totalExperience,
      );
  }

  /**
   * Adiciona XP e retorna somente um resultado de domínio.
   *
   * Não publica evento, não concede skill, não altera Agent e não executa UI.
   */
  public addExperience(
    amount: number,
  ): LevelProgressionChange {
    const previousTotalExperience =
      this.totalExperience;

    const previousLevel =
      this.currentLevel;

    const currentTotalExperience =
      this.experience.add(
        amount,
      );

    const currentLevel =
      this.currentLevel;

    return Object.freeze({
      previousLevel,
      currentLevel,
      levelsGained:
        currentLevel -
        previousLevel,
      previousTotalExperience,
      currentTotalExperience,
    });
  }

  public toSnapshot():
    LevelProgressionSnapshot {
    return Object.freeze({
      totalExperience:
        this.totalExperience,
    });
  }
}
