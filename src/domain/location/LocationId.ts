import {
  createDomainId,
} from "../entities/DomainId";

import type {
  DomainId,
} from "../entities/DomainId";

export type LocationId =
  DomainId<"location">;

export function createLocationId(
  value: string,
): LocationId {
  return createDomainId<
    "location"
  >(value);
}
