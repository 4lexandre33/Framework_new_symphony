import {
  createDomainId,
} from "../entities/DomainId";

import type {
  DomainId,
} from "../entities/DomainId";

export type DefinitionKindId =
  DomainId<
    "definition-kind"
  >;

export type DefinitionId =
  DomainId<"definition">;

export function createDefinitionKindId(
  value: string,
): DefinitionKindId {
  return createDomainId<
    "definition-kind"
  >(value);
}

export function createDefinitionId(
  value: string,
): DefinitionId {
  return createDomainId<
    "definition"
  >(value);
}
