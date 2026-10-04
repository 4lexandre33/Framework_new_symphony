import {
  createDomainId,
} from "../entities/DomainId";

import type {
  DomainId,
} from "../entities/DomainId";

import type {
  InteractionId,
} from "./InteractionId";

export type InteractionActorTypeId =
  DomainId<
    "interaction-actor-type"
  >;

export type InteractionActorId =
  DomainId<
    "interaction-actor"
  >;

export type InteractionTargetTypeId =
  DomainId<
    "interaction-target-type"
  >;

export type InteractionTargetId =
  DomainId<
    "interaction-target"
  >;

export interface InteractionActorRef {
  readonly typeId:
    InteractionActorTypeId;
  readonly actorId:
    InteractionActorId;
}

export interface InteractionTargetRef {
  readonly typeId:
    InteractionTargetTypeId;
  readonly targetId:
    InteractionTargetId;
}

export interface InteractionIntent {
  /**
   * Identifica a ação semântica solicitada.
   *
   * Exemplos:
   * - interaction.open
   * - interaction.talk
   * - interaction.pickup
   * - interaction.use
   */
  readonly interactionId:
    InteractionId;

  /**
   * Quem solicita a interação.
   */
  readonly actor:
    InteractionActorRef;

  /**
   * Alvo lógico da interação.
   *
   * Não contém representação espacial, física ou visual concreta.
   */
  readonly target:
    InteractionTargetRef;
}

export function createInteractionActorTypeId(
  value: string,
): InteractionActorTypeId {
  return createDomainId<
    "interaction-actor-type"
  >(value);
}

export function createInteractionActorId(
  value: string,
): InteractionActorId {
  return createDomainId<
    "interaction-actor"
  >(value);
}

export function createInteractionTargetTypeId(
  value: string,
): InteractionTargetTypeId {
  return createDomainId<
    "interaction-target-type"
  >(value);
}

export function createInteractionTargetId(
  value: string,
): InteractionTargetId {
  return createDomainId<
    "interaction-target"
  >(value);
}

export function createInteractionActorRef(
  typeId:
    InteractionActorTypeId,
  actorId:
    InteractionActorId,
): InteractionActorRef {
  return Object.freeze({
    typeId,
    actorId,
  });
}

export function createInteractionTargetRef(
  typeId:
    InteractionTargetTypeId,
  targetId:
    InteractionTargetId,
): InteractionTargetRef {
  return Object.freeze({
    typeId,
    targetId,
  });
}

export function sameInteractionTargetRef(
  left:
    InteractionTargetRef,
  right:
    InteractionTargetRef,
): boolean {
  return (
    left.typeId ===
      right.typeId &&
    left.targetId ===
      right.targetId
  );
}

export function createInteractionIntent(
  interactionId:
    InteractionId,
  actor:
    InteractionActorRef,
  target:
    InteractionTargetRef,
): InteractionIntent {
  return Object.freeze({
    interactionId,
    actor,
    target,
  });
}
