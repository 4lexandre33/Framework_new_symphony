import {
  createDomainId,
} from "../entities/DomainId";

import type {
  DomainId,
} from "../entities/DomainId";

export type ResourceId =
  DomainId<"resource">;

export function createResourceId(
  value: string,
): ResourceId {
  return createDomainId<
    "resource"
  >(value);
}
