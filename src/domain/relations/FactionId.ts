import {
  createDomainId,
} from "../entities/DomainId";

import type {
  DomainId,
} from "../entities/DomainId";

export type FactionId =
  DomainId<"faction">;

export function createFactionId(
  value: string,
): FactionId {
  return createDomainId<
    "faction"
  >(value);
}
