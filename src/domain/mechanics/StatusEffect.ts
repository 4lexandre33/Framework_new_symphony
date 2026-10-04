import {
  createDomainDuration,
} from "../time/DomainDuration";

import type {
  DomainDuration,
} from "../time/DomainDuration";

import type {
  StatusEffectId,
} from "./StatusEffectId";

export type StatusEffectStackingPolicy =
  | "reject"
  | "stack"
  | "refresh"
  | "stack-and-refresh";

export interface StatusEffectCreateOptions {
  readonly id: StatusEffectId;
  readonly name: string;
  readonly duration?:
    DomainDuration | null;
  readonly maxStacks?: number;
  readonly stackingPolicy?:
    StatusEffectStackingPolicy;
}

export interface StatusEffectSnapshot {
  readonly id: StatusEffectId;
  readonly name: string;
  readonly durationTicks:
    number | null;
  readonly maxStacks: number;
  readonly stackingPolicy:
    StatusEffectStackingPolicy;
}

export type StatusEffectErrorCode =
  | "invalid-name"
  | "invalid-duration"
  | "invalid-max-stacks"
  | "invalid-stacking-policy"
  | "invalid-snapshot";

export class StatusEffectError
  extends Error {
  public readonly name =
    "StatusEffectError";

  public constructor(
    public readonly code:
      StatusEffectErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const MAX_STATUS_EFFECT_NAME_LENGTH =
  160;

function assertName(
  name: string,
): void {
  if (
    name.length === 0 ||
    name.length >
      MAX_STATUS_EFFECT_NAME_LENGTH ||
    name !== name.trim()
  ) {
    throw new StatusEffectError(
      "invalid-name",
      "StatusEffect.name deve ser não vazio, sem whitespace nas extremidades e ter no máximo 160 caracteres.",
    );
  }
}

function assertMaxStacks(
  maxStacks: number,
): void {
  if (
    !Number.isSafeInteger(
      maxStacks,
    ) ||
    maxStacks < 1
  ) {
    throw new StatusEffectError(
      "invalid-max-stacks",
      "StatusEffect.maxStacks deve ser inteiro seguro maior ou igual a 1.",
    );
  }
}

function isStackingPolicy(
  value: string,
): value is
  StatusEffectStackingPolicy {
  return (
    value === "reject" ||
    value === "stack" ||
    value === "refresh" ||
    value ===
      "stack-and-refresh"
  );
}

/**
 * Definição imutável de status effect.
 *
 * Não contém estado de aplicação runtime, renderer, áudio, física, modifiers
 * ou qualquer handle de infraestrutura.
 */
export class StatusEffect {
  public readonly id:
    StatusEffectId;

  public readonly name:
    string;

  public readonly duration:
    DomainDuration | null;

  public readonly maxStacks:
    number;

  public readonly stackingPolicy:
    StatusEffectStackingPolicy;

  public constructor(
    options:
      StatusEffectCreateOptions,
  ) {
    assertName(
      options.name,
    );

    const duration =
      options.duration ?? null;

    if (
      duration !== null &&
      duration <= 0
    ) {
      throw new StatusEffectError(
        "invalid-duration",
        "StatusEffect.duration deve ser maior que 0 ticks quando definida.",
      );
    }

    const stackingPolicy =
      options.stackingPolicy ??
      "reject";

    if (
      !isStackingPolicy(
        stackingPolicy,
      )
    ) {
      throw new StatusEffectError(
        "invalid-stacking-policy",
        `Stacking policy inválida: "${String(stackingPolicy)}".`,
      );
    }

    const maxStacks =
      options.maxStacks ?? 1;

    assertMaxStacks(
      maxStacks,
    );

    if (
      (
        stackingPolicy ===
          "reject" ||
        stackingPolicy ===
          "refresh"
      ) &&
      maxStacks !== 1
    ) {
      throw new StatusEffectError(
        "invalid-max-stacks",
        `Stacking policy "${stackingPolicy}" exige maxStacks = 1.`,
      );
    }

    if (
      (
        stackingPolicy ===
          "refresh" ||
        stackingPolicy ===
          "stack-and-refresh"
      ) &&
      duration === null
    ) {
      throw new StatusEffectError(
        "invalid-duration",
        `Stacking policy "${stackingPolicy}" exige duration finita.`,
      );
    }

    this.id = options.id;
    this.name = options.name;
    this.duration = duration;
    this.maxStacks =
      maxStacks;
    this.stackingPolicy =
      stackingPolicy;
  }

  public static fromSnapshot(
    snapshot:
      StatusEffectSnapshot,
  ): StatusEffect {
    try {
      return new StatusEffect({
        id: snapshot.id,
        name: snapshot.name,
        duration:
          snapshot.durationTicks ===
          null
            ? null
            : createDomainDuration(
                snapshot.durationTicks,
              ),
        maxStacks:
          snapshot.maxStacks,
        stackingPolicy:
          snapshot.stackingPolicy,
      });
    } catch (error) {
      throw new StatusEffectError(
        "invalid-snapshot",
        `StatusEffectSnapshot inválido: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );
    }
  }

  public get isTimed():
    boolean {
    return (
      this.duration !==
      null
    );
  }

  public get canStack():
    boolean {
    return (
      this.stackingPolicy ===
        "stack" ||
      this.stackingPolicy ===
        "stack-and-refresh"
    );
  }

  public get refreshesOnReapply():
    boolean {
    return (
      this.stackingPolicy ===
        "refresh" ||
      this.stackingPolicy ===
        "stack-and-refresh"
    );
  }

  public toSnapshot():
    StatusEffectSnapshot {
    return {
      id: this.id,
      name: this.name,
      durationTicks:
        this.duration,
      maxStacks:
        this.maxStacks,
      stackingPolicy:
        this.stackingPolicy,
    };
  }
}
