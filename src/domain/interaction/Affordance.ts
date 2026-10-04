import type {
  InteractionId,
} from "./InteractionId";

import {
  sameInteractionTargetRef,
} from "./InteractionIntent";

import type {
  InteractionIntent,
  InteractionTargetRef,
} from "./InteractionIntent";

import type {
  InteractionRequirement,
  InteractionRequirementId,
} from "./InteractionRequirement";

export interface AffordanceCreateOptions {
  readonly interactionId:
    InteractionId;
  readonly target:
    InteractionTargetRef;
  readonly requirements?:
    readonly InteractionRequirement[];
}

export interface AffordanceSnapshot {
  readonly interactionId:
    string;
  readonly target:
    {
      readonly typeId:
        string;
      readonly targetId:
        string;
    };
  readonly requirementIds:
    readonly string[];
}

export type AffordanceErrorCode =
  | "duplicate-requirement";

export class AffordanceError
  extends Error {
  public readonly name =
    "AffordanceError";

  public constructor(
    public readonly code:
      AffordanceErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function compareRequirementId(
  left:
    InteractionRequirementId,
  right:
    InteractionRequirementId,
): number {
  return left < right
    ? -1
    : left > right
      ? 1
      : 0;
}

/**
 * Capacidade semântica oferecida por um alvo lógico.
 *
 * Affordance não executa detecção espacial nem leitura de input.
 * Ela apenas declara que um target oferece um InteractionId e quais
 * requirement tokens precisam ser resolvidos pela camada apropriada.
 */
export class Affordance {
  public readonly interactionId:
    InteractionId;

  public readonly target:
    InteractionTargetRef;

  private readonly requirements:
    readonly InteractionRequirement[];

  public constructor(
    options:
      AffordanceCreateOptions,
  ) {
    this.interactionId =
      options.interactionId;

    this.target =
      Object.freeze({
        typeId:
          options.target.typeId,
        targetId:
          options.target.targetId,
      });

    const seen =
      new Set<
        InteractionRequirementId
      >();

    const requirements =
      [
        ...(
          options.requirements ??
          []
        ),
      ];

    for (
      const requirement of
      requirements
    ) {
      if (
        seen.has(
          requirement.id,
        )
      ) {
        throw new AffordanceError(
          "duplicate-requirement",
          `InteractionRequirement duplicado: "${requirement.id}".`,
        );
      }

      seen.add(
        requirement.id,
      );
    }

    requirements.sort(
      (left, right) =>
        compareRequirementId(
          left.id,
          right.id,
        ),
    );

    this.requirements =
      Object.freeze(
        requirements.map(
          (requirement) =>
            Object.freeze({
              id:
                requirement.id,
            }),
        ),
      );
  }

  public get requirementCount():
    number {
    return this.requirements.length;
  }

  public supports(
    intent:
      InteractionIntent,
  ): boolean {
    return (
      intent.interactionId ===
        this.interactionId &&
      sameInteractionTargetRef(
        intent.target,
        this.target,
      )
    );
  }

  public hasRequirement(
    requirementId:
      InteractionRequirementId,
  ): boolean {
    for (
      const requirement of
      this.requirements
    ) {
      if (
        requirement.id ===
        requirementId
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Retorna referência readonly/frozen sem cópia.
   */
  public getRequirements():
    readonly InteractionRequirement[] {
    return this.requirements;
  }

  public toSnapshot():
    AffordanceSnapshot {
    const ids =
      this.requirements.map(
        (requirement) =>
          requirement.id,
      );

    return Object.freeze({
      interactionId:
        this.interactionId,
      target:
        Object.freeze({
          typeId:
            this.target.typeId,
          targetId:
            this.target.targetId,
        }),
      requirementIds:
        Object.freeze(ids),
    });
  }
}
