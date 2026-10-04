import {
  createDomainId,
} from "../entities/DomainId";

import type {
  DomainId,
} from "../entities/DomainId";

export type DomainEventId =
  DomainId<"domain-event">;

export function createDomainEventId(
  value: string,
): DomainEventId {
  return createDomainId<
    "domain-event"
  >(value);
}
