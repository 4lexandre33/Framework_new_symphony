import {
  createDomainId,
} from "../entities/DomainId";

import type {
  DomainId,
} from "../entities/DomainId";

export type CurrencyId =
  DomainId<"currency">;

export function createCurrencyId(
  value: string,
): CurrencyId {
  return createDomainId<
    "currency"
  >(value);
}
