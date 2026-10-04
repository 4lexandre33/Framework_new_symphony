import type {
  DomainEventId,
} from "./DomainEventId";

import type {
  DomainEventMetadata,
} from "./DomainEventMetadata";

import type {
  DomainEventTypeId,
} from "./DomainEventTypeId";

import {
  cloneStateValue,
} from "../state/StateValue";

import type {
  StateValue,
} from "../state/StateValue";

export type DomainEventPayload =
  StateValue;

export interface DomainEvent<
  TPayload extends
    DomainEventPayload =
      DomainEventPayload,
> {
  readonly id:
    DomainEventId;
  readonly typeId:
    DomainEventTypeId;
  readonly metadata:
    DomainEventMetadata;
  readonly payload:
    TPayload;
}

export interface CreateDomainEventOptions<
  TPayload extends
    DomainEventPayload,
> {
  readonly id:
    DomainEventId;
  readonly typeId:
    DomainEventTypeId;
  readonly metadata:
    DomainEventMetadata;
  readonly payload:
    TPayload;
}

/**
 * Cria um DomainEvent imutável e serializável.
 *
 * O payload é deep-cloned/deep-frozen através da disciplina de StateValue,
 * impedindo que uma referência mutável externa altere um evento já criado.
 *
 * DomainEvent é dado semântico. Não possui publish(), emit(), listeners ou
 * qualquer dependência de EventBus/Core.
 */
export function createDomainEvent<
  TPayload extends
    DomainEventPayload,
>(
  options:
    CreateDomainEventOptions<
      TPayload
    >,
): DomainEvent<TPayload> {
  const payload =
    cloneStateValue(
      options.payload,
    ) as TPayload;

  return Object.freeze({
    id: options.id,
    typeId: options.typeId,
    metadata:
      options.metadata,
    payload,
  });
}
