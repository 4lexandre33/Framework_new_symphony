import {
  createDomainId,
} from "../entities/DomainId";

import type {
  DomainId,
} from "../entities/DomainId";

export type CooldownId =
  DomainId<"cooldown">;

export function createCooldownId(
  value: string,
): CooldownId {
  return createDomainId<
    "cooldown"
  >(value);
}
