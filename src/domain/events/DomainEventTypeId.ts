import {
  createDomainId,
} from "../entities/DomainId";

import type {
  DomainId,
} from "../entities/DomainId";

export type DomainEventTypeId =
  DomainId<"domain-event-type">;

export function createDomainEventTypeId(
  value: string,
): DomainEventTypeId {
  return createDomainId<
    "domain-event-type"
  >(value);
}
