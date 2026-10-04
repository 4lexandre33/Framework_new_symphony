import {
  createDomainId,
} from "../entities/DomainId";

import type {
  DomainId,
} from "../entities/DomainId";

export type InteractionId =
  DomainId<"interaction">;

export function createInteractionId(
  value: string,
): InteractionId {
  return createDomainId<
    "interaction"
  >(value);
}
