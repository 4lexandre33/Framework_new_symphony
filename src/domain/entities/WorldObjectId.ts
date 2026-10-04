import {
  createDomainId,
} from "./DomainId";

import type {
  DomainId,
} from "./DomainId";

export type WorldObjectId =
  DomainId<"world-object">;

export function createWorldObjectId(
  value: string,
): WorldObjectId {
  return createDomainId<
    "world-object"
  >(value);
}
