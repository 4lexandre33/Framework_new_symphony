import {
  createDomainId,
} from "../entities/DomainId";

import type {
  DomainId,
} from "../entities/DomainId";

export type ConditionId =
  DomainId<"condition">;

export function createConditionId(
  value: string,
): ConditionId {
  return createDomainId<
    "condition"
  >(value);
}
