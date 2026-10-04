import {
  createDomainId,
} from "../entities/DomainId";

import type {
  DomainId,
} from "../entities/DomainId";

export type StatusEffectId =
  DomainId<"status-effect">;

export function createStatusEffectId(
  value: string,
): StatusEffectId {
  return createDomainId<
    "status-effect"
  >(value);
}
