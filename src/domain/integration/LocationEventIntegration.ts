import {
  createDomainEvent,
  createDomainEventMetadata,
  createDomainEventSourceId,
  createDomainEventSourceRef,
  createDomainEventSourceTypeId,
  createDomainEventTypeId,
} from "../events";

import type {
  DomainEvent,
  DomainEventId,
} from "../events";

import type {
  LocationRef,
} from "../location";

import type {
  SimulationTick,
} from "../time";

export const LOCATION_ENTERED_EVENT_TYPE_ID =
  createDomainEventTypeId(
    "location.entered",
  );

export const LOCATION_EVENT_SOURCE_TYPE_ID =
  createDomainEventSourceTypeId(
    "location",
  );

export interface CreateLocationEnteredEventOptions {
  readonly eventId:
    DomainEventId;
  readonly sequence:
    number;
  readonly tick:
    SimulationTick;
  readonly location:
    LocationRef;
  readonly previousLocation?:
    LocationRef | null;
}

/**
 * Traduz uma entrada lógica de Location em DomainEvent.
 *
 * Nenhum publish é realizado. O evento retornado continua sendo dado puro.
 */
export function createLocationEnteredEvent(
  options:
    CreateLocationEnteredEventOptions,
): DomainEvent {
  const metadata =
    createDomainEventMetadata(
      options.sequence,
      options.tick,
      createDomainEventSourceRef(
        LOCATION_EVENT_SOURCE_TYPE_ID,
        createDomainEventSourceId(
          options.location
            .locationId,
        ),
      ),
    );

  return createDomainEvent({
    id: options.eventId,
    typeId:
      LOCATION_ENTERED_EVENT_TYPE_ID,
    metadata,
    payload: {
      locationId:
        options.location
          .locationId,
      previousLocationId:
        options.previousLocation
          ?.locationId ??
        null,
    },
  });
}
