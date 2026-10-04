import {
  createDomainId,
} from "../entities/DomainId";

import type {
  DomainId,
} from "../entities/DomainId";

import {
  createFactionId,
} from "./FactionId";

import type {
  FactionId,
} from "./FactionId";

export type ReputationSubjectTypeId =
  DomainId<
    "reputation-subject-type"
  >;

export type ReputationSubjectId =
  DomainId<
    "reputation-subject"
  >;

export interface ReputationSubjectRef {
  readonly typeId:
    ReputationSubjectTypeId;
  readonly subjectId:
    ReputationSubjectId;
}

export interface ReputationCreateOptions {
  readonly subject:
    ReputationSubjectRef;
  readonly factionId:
    FactionId;
  readonly min?:
    number;
  readonly max?:
    number;
  readonly current?:
    number;
}

export interface ReputationSnapshot {
  readonly subject:
    {
      readonly typeId:
        string;
      readonly subjectId:
        string;
    };
  readonly factionId:
    string;
  readonly min:
    number;
  readonly max:
    number;
  readonly current:
    number;
}

export type ReputationErrorCode =
  | "invalid-range"
  | "invalid-value"
  | "invalid-delta"
  | "invalid-snapshot";

export class ReputationError
  extends Error {
  public readonly name =
    "ReputationError";

  public constructor(
    public readonly code:
      ReputationErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const DEFAULT_MIN =
  -100;

const DEFAULT_MAX =
  100;

function assertSafeInteger(
  value: number,
  label: string,
  code:
    | "invalid-range"
    | "invalid-value"
    | "invalid-delta",
): void {
  if (
    !Number.isSafeInteger(
      value,
    )
  ) {
    throw new ReputationError(
      code,
      `${label} deve ser inteiro seguro.`,
    );
  }
}

function copySubject(
  subject:
    ReputationSubjectRef,
): ReputationSubjectRef {
  return Object.freeze({
    typeId:
      subject.typeId,
    subjectId:
      subject.subjectId,
  });
}

export function createReputationSubjectTypeId(
  value: string,
): ReputationSubjectTypeId {
  return createDomainId<
    "reputation-subject-type"
  >(value);
}

export function createReputationSubjectId(
  value: string,
): ReputationSubjectId {
  return createDomainId<
    "reputation-subject"
  >(value);
}

export function createReputationSubjectRef(
  typeId:
    ReputationSubjectTypeId,
  subjectId:
    ReputationSubjectId,
): ReputationSubjectRef {
  return Object.freeze({
    typeId,
    subjectId,
  });
}

/**
 * Standing runtime de um sujeito lógico perante uma facção.
 *
 * Range configurável; defaults: -100..100.
 * adjust() satura no range e retorna o delta realmente aplicado.
 */
export class Reputation {
  public readonly subject:
    ReputationSubjectRef;

  public readonly factionId:
    FactionId;

  public readonly min:
    number;

  public readonly max:
    number;

  private currentValue:
    number;

  public constructor(
    options:
      ReputationCreateOptions,
  ) {
    const min =
      options.min ??
      DEFAULT_MIN;

    const max =
      options.max ??
      DEFAULT_MAX;

    const current =
      options.current ??
      0;

    assertSafeInteger(
      min,
      "Reputation.min",
      "invalid-range",
    );

    assertSafeInteger(
      max,
      "Reputation.max",
      "invalid-range",
    );

    if (min >= max) {
      throw new ReputationError(
        "invalid-range",
        "Reputation.min deve ser menor que max.",
      );
    }

    assertSafeInteger(
      current,
      "Reputation.current",
      "invalid-value",
    );

    if (
      current < min ||
      current > max
    ) {
      throw new ReputationError(
        "invalid-value",
        "Reputation.current deve estar dentro do range.",
      );
    }

    this.subject =
      copySubject(
        options.subject,
      );
    this.factionId =
      options.factionId;
    this.min = min;
    this.max = max;
    this.currentValue =
      current;
  }

  public static fromSnapshot(
    snapshot:
      ReputationSnapshot,
  ): Reputation {
    try {
      return new Reputation({
        subject:
          createReputationSubjectRef(
            createReputationSubjectTypeId(
              snapshot.subject
                .typeId,
            ),
            createReputationSubjectId(
              snapshot.subject
                .subjectId,
            ),
          ),
        factionId:
          createFactionId(
            snapshot.factionId,
          ),
        min: snapshot.min,
        max: snapshot.max,
        current:
          snapshot.current,
      });
    } catch (error) {
      throw new ReputationError(
        "invalid-snapshot",
        `ReputationSnapshot inválido: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );
    }
  }

  public get current():
    number {
    return this.currentValue;
  }

  public get isMinimum():
    boolean {
    return (
      this.currentValue ===
      this.min
    );
  }

  public get isMaximum():
    boolean {
    return (
      this.currentValue ===
      this.max
    );
  }

  public get normalized01():
    number {
    return (
      (
        this.currentValue -
        this.min
      ) /
      (
        this.max -
        this.min
      )
    );
  }

  /**
   * Ajuste saturado.
   *
   * Retorna o delta realmente aplicado.
   */
  public adjust(
    delta: number,
  ): number {
    assertSafeInteger(
      delta,
      "Reputation.adjust delta",
      "invalid-delta",
    );

    const before =
      this.currentValue;

    const candidate =
      before + delta;

    if (
      candidate <
      this.min
    ) {
      this.currentValue =
        this.min;
    } else if (
      candidate >
      this.max
    ) {
      this.currentValue =
        this.max;
    } else {
      this.currentValue =
        candidate;
    }

    return (
      this.currentValue -
      before
    );
  }

  /**
   * Set estrito; não faz clamp silencioso.
   */
  public set(
    value: number,
  ): void {
    assertSafeInteger(
      value,
      "Reputation.set value",
      "invalid-value",
    );

    if (
      value < this.min ||
      value > this.max
    ) {
      throw new ReputationError(
        "invalid-value",
        "Reputation value deve estar dentro do range.",
      );
    }

    this.currentValue =
      value;
  }

  public toSnapshot():
    ReputationSnapshot {
    return Object.freeze({
      subject:
        Object.freeze({
          typeId:
            this.subject.typeId,
          subjectId:
            this.subject.subjectId,
        }),
      factionId:
        this.factionId,
      min: this.min,
      max: this.max,
      current:
        this.currentValue,
    });
  }
}
