import {
  createDomainId,
} from "../entities/DomainId";

import type {
  DomainId,
} from "../entities/DomainId";

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
  StatusEffect,
} from "./StatusEffect";

export type StatusEffectInstanceId =
  DomainId<
    "status-effect-instance"
  >;

export type StatusEffectSourceTypeId =
  DomainId<
    "status-effect-source-type"
  >;

export type StatusEffectSourceId =
  DomainId<
    "status-effect-source"
  >;

export interface StatusEffectSourceRef {
  readonly typeId:
    StatusEffectSourceTypeId;
  readonly sourceId:
    StatusEffectSourceId;
}

export type StatusEffectInstanceStatus =
  | "active"
  | "expired"
  | "removed";

export interface StatusEffectInstanceCreateOptions {
  readonly id:
    StatusEffectInstanceId;
  readonly effect:
    StatusEffect;
  readonly source?:
    StatusEffectSourceRef | null;
  readonly initialStacks?:
    number;
}

export interface StatusEffectInstanceSnapshot {
  readonly id:
    StatusEffectInstanceId;
  readonly effectId:
    string;
  readonly source:
    StatusEffectSourceRef | null;
  readonly stacks:
    number;
  readonly status:
    StatusEffectInstanceStatus;
  readonly timer:
    TimerSnapshot | null;
}

export type StatusEffectInstanceErrorCode =
  | "invalid-stack-count"
  | "invalid-transition"
  | "invalid-snapshot"
  | "effect-mismatch";

export class StatusEffectInstanceError
  extends Error {
  public readonly name =
    "StatusEffectInstanceError";

  public constructor(
    public readonly code:
      StatusEffectInstanceErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function assertStackCount(
  value: number,
  maxStacks: number,
): void {
  if (
    !Number.isSafeInteger(
      value,
    ) ||
    value < 1 ||
    value > maxStacks
  ) {
    throw new StatusEffectInstanceError(
      "invalid-stack-count",
      `Stacks deve ser inteiro entre 1 e ${String(maxStacks)}.`,
    );
  }
}

function copySource(
  source:
    StatusEffectSourceRef | null,
): StatusEffectSourceRef | null {
  if (source === null) {
    return null;
  }

  return Object.freeze({
    typeId: source.typeId,
    sourceId:
      source.sourceId,
  });
}

export function createStatusEffectInstanceId(
  value: string,
): StatusEffectInstanceId {
  return createDomainId<
    "status-effect-instance"
  >(value);
}

export function createStatusEffectSourceTypeId(
  value: string,
): StatusEffectSourceTypeId {
  return createDomainId<
    "status-effect-source-type"
  >(value);
}

export function createStatusEffectSourceId(
  value: string,
): StatusEffectSourceId {
  return createDomainId<
    "status-effect-source"
  >(value);
}

export function createStatusEffectSourceRef(
  typeId:
    StatusEffectSourceTypeId,
  sourceId:
    StatusEffectSourceId,
): StatusEffectSourceRef {
  return Object.freeze({
    typeId,
    sourceId,
  });
}

/**
 * Estado runtime de uma aplicação de StatusEffect.
 *
 * O timer avança somente por input explícito de DomainDuration.
 */
export class StatusEffectInstance {
  public readonly id:
    StatusEffectInstanceId;

  public readonly effect:
    StatusEffect;

  private sourceValue:
    StatusEffectSourceRef | null;

  private stacksValue:
    number;

  private statusValue:
    StatusEffectInstanceStatus =
      "active";

  private timer:
    SimulationTimer | null;

  public constructor(
    options:
      StatusEffectInstanceCreateOptions,
  ) {
    const initialStacks =
      options.initialStacks ??
      1;

    assertStackCount(
      initialStacks,
      options.effect.maxStacks,
    );

    this.id = options.id;
    this.effect =
      options.effect;
    this.sourceValue =
      copySource(
        options.source ?? null,
      );
    this.stacksValue =
      initialStacks;

    this.timer =
      options.effect.duration ===
      null
        ? null
        : new SimulationTimer({
            duration:
              options.effect
                .duration,
            autoStart: true,
          });
  }

  public static fromSnapshot(
    effect: StatusEffect,
    snapshot:
      StatusEffectInstanceSnapshot,
  ): StatusEffectInstance {
    if (
      snapshot.effectId !==
      effect.id
    ) {
      throw new StatusEffectInstanceError(
        "effect-mismatch",
        `Snapshot pertence ao effect "${snapshot.effectId}", mas recebeu "${effect.id}".`,
      );
    }

    assertStackCount(
      snapshot.stacks,
      effect.maxStacks,
    );

    let source:
      StatusEffectSourceRef | null =
        null;

    try {
      source =
        snapshot.source ===
        null
          ? null
          : createStatusEffectSourceRef(
              createStatusEffectSourceTypeId(
                snapshot.source
                  .typeId,
              ),
              createStatusEffectSourceId(
                snapshot.source
                  .sourceId,
              ),
            );
    } catch (error) {
      throw new StatusEffectInstanceError(
        "invalid-snapshot",
        `Source inválido: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );
    }

    const instance =
      new StatusEffectInstance({
        id: snapshot.id,
        effect,
        source,
        initialStacks:
          snapshot.stacks,
      });

    if (
      effect.duration === null
    ) {
      if (
        snapshot.timer !==
        null
      ) {
        throw new StatusEffectInstanceError(
          "invalid-snapshot",
          "Effect permanente não pode possuir TimerSnapshot.",
        );
      }
    } else {
      if (
        snapshot.timer ===
        null
      ) {
        throw new StatusEffectInstanceError(
          "invalid-snapshot",
          "Effect temporário exige TimerSnapshot.",
        );
      }

      let restoredTimer:
        SimulationTimer;

      try {
        restoredTimer =
          SimulationTimer
            .fromSnapshot(
              snapshot.timer,
            );
      } catch (error) {
        throw new StatusEffectInstanceError(
          "invalid-snapshot",
          `TimerSnapshot inválido: ${
            error instanceof Error
              ? error.message
              : String(error)
          }`,
        );
      }

      if (
        restoredTimer.duration !==
        effect.duration
      ) {
        throw new StatusEffectInstanceError(
          "invalid-snapshot",
          "TimerSnapshot.duration não corresponde ao StatusEffect.duration.",
        );
      }

      instance.timer =
        restoredTimer;
    }

    switch (
      snapshot.status
    ) {
      case "active":
        if (
          snapshot.timer !==
            null &&
          snapshot.timer.status !==
            "running"
        ) {
          throw new StatusEffectInstanceError(
            "invalid-snapshot",
            "Instância active exige timer running quando temporária.",
          );
        }
        break;

      case "expired":
        if (
          snapshot.timer ===
            null ||
          snapshot.timer.status !==
            "completed"
        ) {
          throw new StatusEffectInstanceError(
            "invalid-snapshot",
            "Instância expired exige timer completed.",
          );
        }
        break;

      case "removed":
        break;

      default:
        throw new StatusEffectInstanceError(
          "invalid-snapshot",
          `Status inválido: "${String(snapshot.status)}".`,
        );
    }

    instance.statusValue =
      snapshot.status;

    return instance;
  }

  public get source():
    StatusEffectSourceRef | null {
    return this.sourceValue;
  }

  public get stacks():
    number {
    return this.stacksValue;
  }

  public get status():
    StatusEffectInstanceStatus {
    return this.statusValue;
  }

  public get isActive():
    boolean {
    return (
      this.statusValue ===
      "active"
    );
  }

  public get isTerminal():
    boolean {
    return (
      this.statusValue !==
      "active"
    );
  }

  public get remaining():
    DomainDuration | null {
    return (
      this.timer?.remaining ??
      null
    );
  }

  public get progress01():
    number | null {
    return (
      this.timer?.progress01 ??
      null
    );
  }

  public updateSource(
    source:
      StatusEffectSourceRef | null,
  ): void {
    if (!this.isActive) {
      throw new StatusEffectInstanceError(
        "invalid-transition",
        `updateSource() exige status "active"; atual: "${this.statusValue}".`,
      );
    }

    this.sourceValue =
      copySource(source);
  }

  public addStacks(
    count = 1,
  ): number {
    if (!this.isActive) {
      throw new StatusEffectInstanceError(
        "invalid-transition",
        `addStacks() exige status "active"; atual: "${this.statusValue}".`,
      );
    }

    if (
      !Number.isSafeInteger(
        count,
      ) ||
      count < 1
    ) {
      throw new StatusEffectInstanceError(
        "invalid-stack-count",
        "count deve ser inteiro seguro maior ou igual a 1.",
      );
    }

    if (
      !this.effect.canStack
    ) {
      return 0;
    }

    const capacity =
      this.effect.maxStacks -
      this.stacksValue;

    const applied =
      count < capacity
        ? count
        : capacity;

    if (applied <= 0) {
      return 0;
    }

    this.stacksValue +=
      applied;

    return applied;
  }

  public refreshDuration():
    boolean {
    if (!this.isActive) {
      throw new StatusEffectInstanceError(
        "invalid-transition",
        `refreshDuration() exige status "active"; atual: "${this.statusValue}".`,
      );
    }

    if (
      this.timer === null
    ) {
      return false;
    }

    this.timer.reset(true);

    return true;
  }

  public advance(
    elapsed:
      DomainDuration,
  ): DomainDuration {
    if (
      !this.isActive ||
      this.timer === null
    ) {
      return createDomainDuration(
        0,
      );
    }

    const applied =
      this.timer.advance(
        elapsed,
      );

    if (
      this.timer.isCompleted
    ) {
      this.statusValue =
        "expired";
    }

    return applied;
  }

  public remove(): boolean {
    if (!this.isActive) {
      return false;
    }

    this.statusValue =
      "removed";

    return true;
  }

  public toSnapshot():
    StatusEffectInstanceSnapshot {
    return {
      id: this.id,
      effectId:
        this.effect.id,
      source:
        this.sourceValue,
      stacks:
        this.stacksValue,
      status:
        this.statusValue,
      timer:
        this.timer
          ?.toSnapshot() ??
        null,
    };
  }
}
