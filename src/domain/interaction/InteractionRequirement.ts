import {
  createDomainId,
} from "../entities/DomainId";

import type {
  DomainId,
} from "../entities/DomainId";

export type InteractionRequirementId =
  DomainId<
    "interaction-requirement"
  >;

export interface InteractionRequirement {
  /**
   * Token semântico de requisito.
   *
   * A Etapa 54 não define COMO o requisito é avaliado.
   * A integração com Conditions fica reservada para a Etapa 62.
   */
  readonly id:
    InteractionRequirementId;
}

export interface InteractionRequirementResolution {
  readonly requirementId:
    InteractionRequirementId;
  readonly satisfied:
    boolean;
}

export function createInteractionRequirementId(
  value: string,
): InteractionRequirementId {
  return createDomainId<
    "interaction-requirement"
  >(value);
}

export function createInteractionRequirement(
  id:
    InteractionRequirementId,
): InteractionRequirement {
  return Object.freeze({
    id,
  });
}

export function createInteractionRequirementResolution(
  requirementId:
    InteractionRequirementId,
  satisfied: boolean,
): InteractionRequirementResolution {
  return Object.freeze({
    requirementId,
    satisfied,
  });
}
