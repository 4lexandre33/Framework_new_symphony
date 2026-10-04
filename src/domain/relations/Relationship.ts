import {
  createDomainId,
} from "../entities/DomainId";

import type {
  DomainId,
} from "../entities/DomainId";

export type RelationshipId =
  DomainId<"relationship">;

export type RelationshipTypeId =
  DomainId<
    "relationship-type"
  >;

export type RelationshipSubjectTypeId =
  DomainId<
    "relationship-subject-type"
  >;

export type RelationshipSubjectId =
  DomainId<
    "relationship-subject"
  >;

export interface RelationshipSubjectRef {
  readonly typeId:
    RelationshipSubjectTypeId;
  readonly subjectId:
    RelationshipSubjectId;
}

export interface RelationshipCreateOptions {
  readonly id:
    RelationshipId;
  readonly typeId:
    RelationshipTypeId;
  readonly source:
    RelationshipSubjectRef;
  readonly target:
    RelationshipSubjectRef;
  readonly strength?:
    number;
}

export interface RelationshipSnapshot {
  readonly id:
    string;
  readonly typeId:
    string;
  readonly source:
    {
      readonly typeId:
        string;
      readonly subjectId:
        string;
    };
  readonly target:
    {
      readonly typeId:
        string;
      readonly subjectId:
        string;
    };
  readonly strength:
    number;
}

export type RelationshipErrorCode =
  | "self-relationship"
  | "invalid-strength"
  | "invalid-delta"
  | "invalid-snapshot";

export class RelationshipError
  extends Error {
  public readonly name =
    "RelationshipError";

  public constructor(
    public readonly code:
      RelationshipErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const RELATIONSHIP_MIN_STRENGTH =
  -100;

export const RELATIONSHIP_MAX_STRENGTH =
  100;

function assertStrength(
  value: number,
  code:
    | "invalid-strength"
    | "invalid-delta",
): void {
  if (
    !Number.isSafeInteger(
      value,
    )
  ) {
    throw new RelationshipError(
      code,
      "Relationship strength/delta deve ser inteiro seguro.",
    );
  }
}

function copySubject(
  subject:
    RelationshipSubjectRef,
): RelationshipSubjectRef {
  return Object.freeze({
    typeId:
      subject.typeId,
    subjectId:
      subject.subjectId,
  });
}

export function createRelationshipId(
  value: string,
): RelationshipId {
  return createDomainId<
    "relationship"
  >(value);
}

export function createRelationshipTypeId(
  value: string,
): RelationshipTypeId {
  return createDomainId<
    "relationship-type"
  >(value);
}

export function createRelationshipSubjectTypeId(
  value: string,
): RelationshipSubjectTypeId {
  return createDomainId<
    "relationship-subject-type"
  >(value);
}

export function createRelationshipSubjectId(
  value: string,
): RelationshipSubjectId {
  return createDomainId<
    "relationship-subject"
  >(value);
}

export function createRelationshipSubjectRef(
  typeId:
    RelationshipSubjectTypeId,
  subjectId:
    RelationshipSubjectId,
): RelationshipSubjectRef {
  return Object.freeze({
    typeId,
    subjectId,
  });
}

export function sameRelationshipSubjectRef(
  left:
    RelationshipSubjectRef,
  right:
    RelationshipSubjectRef,
): boolean {
  return (
    left.typeId ===
      right.typeId &&
    left.subjectId ===
      right.subjectId
  );
}

/**
 * Relação direcional tipada entre dois sujeitos lógicos.
 *
 * `typeId` é semanticamente aberto: friend, rival, mentor, family etc.
 * `strength` usa range canônico -100..100 e não define automaticamente
 * comportamento de gameplay.
 */
export class Relationship {
  public readonly id:
    RelationshipId;

  public readonly typeId:
    RelationshipTypeId;

  public readonly source:
    RelationshipSubjectRef;

  public readonly target:
    RelationshipSubjectRef;

  private strengthValue:
    number;

  public constructor(
    options:
      RelationshipCreateOptions,
  ) {
    if (
      sameRelationshipSubjectRef(
        options.source,
        options.target,
      )
    ) {
      throw new RelationshipError(
        "self-relationship",
        "Relationship source e target devem representar sujeitos distintos.",
      );
    }

    const strength =
      options.strength ?? 0;

    assertStrength(
      strength,
      "invalid-strength",
    );

    if (
      strength <
        RELATIONSHIP_MIN_STRENGTH ||
      strength >
        RELATIONSHIP_MAX_STRENGTH
    ) {
      throw new RelationshipError(
        "invalid-strength",
        `Relationship.strength deve estar entre ${String(RELATIONSHIP_MIN_STRENGTH)} e ${String(RELATIONSHIP_MAX_STRENGTH)}.`,
      );
    }

    this.id = options.id;
    this.typeId =
      options.typeId;
    this.source =
      copySubject(
        options.source,
      );
    this.target =
      copySubject(
        options.target,
      );
    this.strengthValue =
      strength;
  }

  public static fromSnapshot(
    snapshot:
      RelationshipSnapshot,
  ): Relationship {
    try {
      return new Relationship({
        id:
          createRelationshipId(
            snapshot.id,
          ),
        typeId:
          createRelationshipTypeId(
            snapshot.typeId,
          ),
        source:
          createRelationshipSubjectRef(
            createRelationshipSubjectTypeId(
              snapshot.source
                .typeId,
            ),
            createRelationshipSubjectId(
              snapshot.source
                .subjectId,
            ),
          ),
        target:
          createRelationshipSubjectRef(
            createRelationshipSubjectTypeId(
              snapshot.target
                .typeId,
            ),
            createRelationshipSubjectId(
              snapshot.target
                .subjectId,
            ),
          ),
        strength:
          snapshot.strength,
      });
    } catch (error) {
      throw new RelationshipError(
        "invalid-snapshot",
        `RelationshipSnapshot inválido: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );
    }
  }

  public get strength():
    number {
    return this.strengthValue;
  }

  public setStrength(
    value: number,
  ): void {
    assertStrength(
      value,
      "invalid-strength",
    );

    if (
      value <
        RELATIONSHIP_MIN_STRENGTH ||
      value >
        RELATIONSHIP_MAX_STRENGTH
    ) {
      throw new RelationshipError(
        "invalid-strength",
        `Relationship.strength deve estar entre ${String(RELATIONSHIP_MIN_STRENGTH)} e ${String(RELATIONSHIP_MAX_STRENGTH)}.`,
      );
    }

    this.strengthValue =
      value;
  }

  /**
   * Ajuste saturado, retornando o delta realmente aplicado.
   */
  public adjustStrength(
    delta: number,
  ): number {
    assertStrength(
      delta,
      "invalid-delta",
    );

    const before =
      this.strengthValue;

    const candidate =
      before + delta;

    if (
      candidate <
      RELATIONSHIP_MIN_STRENGTH
    ) {
      this.strengthValue =
        RELATIONSHIP_MIN_STRENGTH;
    } else if (
      candidate >
      RELATIONSHIP_MAX_STRENGTH
    ) {
      this.strengthValue =
        RELATIONSHIP_MAX_STRENGTH;
    } else {
      this.strengthValue =
        candidate;
    }

    return (
      this.strengthValue -
      before
    );
  }

  public toSnapshot():
    RelationshipSnapshot {
    return Object.freeze({
      id: this.id,
      typeId:
        this.typeId,
      source:
        Object.freeze({
          typeId:
            this.source.typeId,
          subjectId:
            this.source.subjectId,
        }),
      target:
        Object.freeze({
          typeId:
            this.target.typeId,
          subjectId:
            this.target.subjectId,
        }),
      strength:
        this.strengthValue,
    });
  }
}
