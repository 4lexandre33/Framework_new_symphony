import {
  createDomainDuration,
} from "../time/DomainDuration";

import type {
  DomainDuration,
} from "../time/DomainDuration";

import {
  SimulationTimer,
} from "../time/SimulationTimer";

import type {
  TimerSnapshot,
} from "../time/TimerSnapshot";

import type {
  CooldownId,
} from "./CooldownId";

export interface CooldownCreateOptions {
  readonly id:
    CooldownId;
  readonly duration:
    DomainDuration;
  readonly startActive?:
    boolean;
}

export interface CooldownSnapshot {
  readonly id:
    string;
  readonly durationTicks:
    number;
  readonly timer:
    TimerSnapshot;
}

export type CooldownErrorCode =
  | "invalid-duration"
  | "already-active"
  | "invalid-snapshot";

export class CooldownError
  extends Error {
  public readonly name =
    "CooldownError";

  public constructor(
    public readonly code:
      CooldownErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Cooldown determinístico.
 *
 * O tempo só avança por advance(elapsed). Nenhum wall clock é consultado.
 *
 * ready:
 * - timer idle ou completed.
 *
 * active:
 * - timer running.
 */
export class Cooldown {
  public readonly id:
    CooldownId;

  public readonly duration:
    DomainDuration;

  private timer:
    SimulationTimer;

  public constructor(
    options:
      CooldownCreateOptions,
  ) {
    if (
      options.duration <= 0
    ) {
      throw new CooldownError(
        "invalid-duration",
        "Cooldown.duration deve ser maior que 0 ticks.",
      );
    }

    this.id = options.id;
    this.duration =
      options.duration;
    this.timer =
      new SimulationTimer({
        duration:
          options.duration,
        autoStart:
          options.startActive ===
          true,
      });
  }

  public static fromSnapshot(
    snapshot:
      CooldownSnapshot,
  ): Cooldown {
    let timer:
      SimulationTimer;

    try {
      timer =
        SimulationTimer
          .fromSnapshot(
            snapshot.timer,
          );
    } catch (error) {
      throw new CooldownError(
        "invalid-snapshot",
        `Cooldown TimerSnapshot inválido: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );
    }

    let duration:
      DomainDuration;

    try {
      duration =
        createDomainDuration(
          snapshot.durationTicks,
        );
    } catch (error) {
      throw new CooldownError(
        "invalid-snapshot",
        `Cooldown.durationTicks inválido: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );
    }

    if (duration <= 0) {
      throw new CooldownError(
        "invalid-snapshot",
        "Cooldown.durationTicks deve ser maior que 0.",
      );
    }

    if (
      timer.duration !==
      duration
    ) {
      throw new CooldownError(
        "invalid-snapshot",
        "Cooldown timer.duration não corresponde a durationTicks.",
      );
    }

    const cooldown =
      new Cooldown({
        id:
          snapshot.id as CooldownId,
        duration,
      });

    cooldown.timer =
      timer;

    return cooldown;
  }

  public get isActive():
    boolean {
    return (
      this.timer.status ===
      "running"
    );
  }

  public get isReady():
    boolean {
    return !this.isActive;
  }

  public get remaining():
    DomainDuration {
    if (
      this.timer.status ===
      "idle" ||
      this.timer.status ===
      "completed"
    ) {
      return createDomainDuration(
        0,
      );
    }

    return this.timer.remaining;
  }

  public get elapsed():
    DomainDuration {
    return this.timer.elapsed;
  }

  public get progress01():
    number {
    if (
      this.timer.status ===
      "idle"
    ) {
      return 1;
    }

    return this.timer.progress01;
  }

  /**
   * Inicia somente quando ready.
   *
   * completed é reutilizado via reset(true).
   */
  public start(): void {
    if (this.isActive) {
      throw new CooldownError(
        "already-active",
        `Cooldown "${this.id}" já está ativo.`,
      );
    }

    this.timer.reset(true);
  }

  /**
   * Reinicia incondicionalmente a contagem.
   */
  public restart(): void {
    this.timer.reset(true);
  }

  /**
   * Cancela/limpa o cooldown e volta imediatamente a ready.
   */
  public clear(): void {
    this.timer.reset(false);
  }

  /**
   * Avança somente quando ativo.
   * Retorna ticks efetivamente consumidos.
   */
  public advance(
    elapsed:
      DomainDuration,
  ): DomainDuration {
    if (!this.isActive) {
      return createDomainDuration(
        0,
      );
    }

    return this.timer.advance(
      elapsed,
    );
  }

  public toSnapshot():
    CooldownSnapshot {
    return {
      id: this.id,
      durationTicks:
        this.duration,
      timer:
        this.timer
          .toSnapshot(),
    };
  }
}
