import {
  createDomainId,
} from "../entities/DomainId";

import type {
  DomainId,
} from "../entities/DomainId";

import type {
  StateValue,
} from "./StateValue";

declare const STATE_VALUE_TYPE:
  unique symbol;

/**
 * Chave nominal de State com tipo de valor opcional em compile-time.
 *
 * Runtime continua sendo apenas string.
 */
export type StateKey<
  TValue extends
    StateValue = StateValue,
> =
  DomainId<"state-key"> & {
    readonly [STATE_VALUE_TYPE]:
      TValue;
  };

export function createStateKey<
  TValue extends
    StateValue = StateValue,
>(
  value: string,
): StateKey<TValue> {
  return createDomainId<
    "state-key"
  >(value) as StateKey<TValue>;
}
