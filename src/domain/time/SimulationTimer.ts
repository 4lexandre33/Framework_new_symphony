import {
  createDomainDuration,
} from "./DomainDuration";

import type {
  DomainDuration,
} from "./DomainDuration";

import type {
  SimulationTimerStatus,
  TimerSnapshot,
} from "./TimerSnapshot";

export type SimulationTimerErrorCode =
  | "invalid-duration"
  | "invalid-transition"
  | "invalid-snapshot"
  | "elapsed-overflow";

export class SimulationTimerError
  extends Error {
  public readonly name =
    "SimulationTimerError";

  public constructor(
    public readonly code:
      SimulationTimerErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface SimulationTimerCreateOptions {
  readonly duration:
    DomainDuration;
  readonly autoStart?:
    boolean;
}

function assertPositiveDuration(
  duration:
    DomainDuration,
): void {
  if (duration <= 0) {
    throw new SimulationTimerError(
      "invalid-duration",
      "SimulationTimer.duration deve ser maior que 0 ticks.",
    );
  }
}

function assertAdvanceDuration(
  duration:
    DomainDuration,
): void {
  if (duration < 0) {
    throw new SimulationTimerError(
      "invalid-duration",
      "Elapsed duration não pode ser negativa.",
    );
  }
}

function assertSnapshot(
  snapshot:
    TimerSnapshot,
): void {
  if (
    !Number.isSafeInteger(
      snapshot.durationTicks,
    ) ||
    snapshot.durationTicks <=
      0
  ) {
    throw new SimulationTimerError(
      "invalid-snapshot",
      "TimerSnapshot.durationTicks deve ser inteiro seguro maior que 0.",
    );
  }

  if (
    !Number.isSafeInteger(
      snapshot.elapsedTicks,
    ) ||
    snapshot.elapsedTicks < 0 ||
    snapshot.elapsedTicks >
      snapshot.durationTicks
  ) {
    throw new SimulationTimerError(
      "invalid-snapshot",
      "TimerSnapshot.elapsedTicks fora do intervalo permitido.",
    );
  }

  switch (snapshot.status) {
    case "idle":
      if (
        snapshot.elapsedTicks !==
        0
      ) {
        throw new SimulationTimerError(
          "invalid-snapshot",
          "Timer idle precisa possuir elapsedTicks 0.",
        );
      }
      return;

    case "running":
    case "paused":
      if (
        snapshot.elapsedTicks >=
        snapshot.durationTicks
      ) {
        throw new SimulationTimerError(
          "invalid-snapshot",
          `Timer ${snapshot.status} precisa possuir elapsedTicks menor que durationTicks.`,
        );
      }
      return;

    case "completed":
      if (
        snapshot.elapsedTicks !==
        snapshot.durationTicks
      ) {
        throw new SimulationTimerError(
          "invalid-snapshot",
          "Timer completed precisa possuir elapsedTicks igual a durationTicks.",
        );
      }
      return;
  }
}

/**
 * Timer determinístico de domínio.
 *
 * Não lê relógio, não conhece FPS e não importa GameLoop.
 * A camada superior fornece elapsed DomainDuration explicitamente.
 *
 * Lifecycle:
 * idle -> running -> paused -> running -> completed
 * idle/running/paused/completed -> reset() -> idle
 *
 * advance() muta somente números/status in-place e não aloca objetos.
 */
export class SimulationTimer {
  public readonly duration:
    DomainDuration;

  private elapsedValue:
    DomainDuration =
      createDomainDuration(0);

  private statusValue:
    SimulationTimerStatus;

  public constructor(
    options:
      SimulationTimerCreateOptions,
  ) {
    assertPositiveDuration(
      options.duration,
    );

    this.duration =
      options.duration;

    this.statusValue =
      options.autoStart ===
      true
        ? "running"
        : "idle";
  }

  public static fromSnapshot(
    snapshot:
      TimerSnapshot,
  ): SimulationTimer {
    assertSnapshot(snapshot);

    const timer =
      new SimulationTimer({
        duration:
          createDomainDuration(
            snapshot.durationTicks,
          ),
      });

    timer.elapsedValue =
      createDomainDuration(
        snapshot.elapsedTicks,
      );

    timer.statusValue =
      snapshot.status;

    return timer;
  }

  public get elapsed():
    DomainDuration {
    return this.elapsedValue;
  }

  public get remaining():
    DomainDuration {
    return createDomainDuration(
      this.duration -
        this.elapsedValue,
    );
  }

  public get status():
    SimulationTimerStatus {
    return this.statusValue;
  }

  public get isRunning():
    boolean {
    return (
      this.statusValue ===
      "running"
    );
  }

  public get isCompleted():
    boolean {
    return (
      this.statusValue ===
      "completed"
    );
  }

  public get progress01():
    number {
    return (
      this.elapsedValue /
      this.duration
    );
  }

  public start(): void {
    if (
      this.statusValue !==
      "idle"
    ) {
      throw new SimulationTimerError(
        "invalid-transition",
        `start() exige status "idle"; atual: "${this.statusValue}".`,
      );
    }

    this.statusValue =
      "running";
  }

  public pause(): void {
    if (
      this.statusValue !==
      "running"
    ) {
      throw new SimulationTimerError(
        "invalid-transition",
        `pause() exige status "running"; atual: "${this.statusValue}".`,
      );
    }

    this.statusValue =
      "paused";
  }

  public resume(): void {
    if (
      this.statusValue !==
      "paused"
    ) {
      throw new SimulationTimerError(
        "invalid-transition",
        `resume() exige status "paused"; atual: "${this.statusValue}".`,
      );
    }

    this.statusValue =
      "running";
  }

  /**
   * Avança o timer e retorna quantos ticks foram efetivamente aplicados.
   *
   * Quando paused/idle/completed, elapsed não é consumido e retorna 0.
   */
  public advance(
    elapsed:
      DomainDuration,
  ): DomainDuration {
    assertAdvanceDuration(
      elapsed,
    );

    if (
      this.statusValue !==
        "running" ||
      elapsed === 0
    ) {
      return createDomainDuration(
        0,
      );
    }

    const remaining =
      this.duration -
      this.elapsedValue;

    const applied =
      elapsed < remaining
        ? elapsed
        : remaining;

    const next =
      this.elapsedValue +
      applied;

    if (
      !Number.isSafeInteger(next)
    ) {
      throw new SimulationTimerError(
        "elapsed-overflow",
        "SimulationTimer.elapsed excedeu o limite de inteiro seguro.",
      );
    }

    this.elapsedValue =
      createDomainDuration(next);

    if (
      this.elapsedValue ===
      this.duration
    ) {
      this.statusValue =
        "completed";
    }

    return createDomainDuration(
      applied,
    );
  }

  public complete(): void {
    if (
      this.statusValue !==
        "running" &&
      this.statusValue !==
        "paused"
    ) {
      throw new SimulationTimerError(
        "invalid-transition",
        `complete() exige status "running" ou "paused"; atual: "${this.statusValue}".`,
      );
    }

    this.elapsedValue =
      this.duration;

    this.statusValue =
      "completed";
  }

  public reset(
    autoStart = false,
  ): void {
    this.elapsedValue =
      createDomainDuration(0);

    this.statusValue =
      autoStart
        ? "running"
        : "idle";
  }

  public toSnapshot():
    TimerSnapshot {
    return {
      durationTicks:
        this.duration,
      elapsedTicks:
        this.elapsedValue,
      status:
        this.statusValue,
    };
  }
}
