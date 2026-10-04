import {
  createDomainId,
} from "./DomainId";

import type {
  DomainId,
} from "./DomainId";

export type ObjectStateId =
  DomainId<"object-state">;

export interface ObjectStateRef {
  readonly stateId:
    ObjectStateId;
}

export function createObjectStateId(
  value: string,
): ObjectStateId {
  return createDomainId<
    "object-state"
  >(value);
}

/**
 * Referência opaca para estado lógico associado ao objeto.
 *
 * A Etapa 46 não implementa StateStore. Este contrato existe para que
 * ObjectProp possa apontar semanticamente para um estado futuro sem depender
 * de storage, engine ou da implementação da Etapa 47.
 */
export function createObjectStateRef(
  stateId: ObjectStateId,
): ObjectStateRef {
  return Object.freeze({
    stateId,
  });
}

export function sameObjectStateRef(
  left: ObjectStateRef,
  right: ObjectStateRef,
): boolean {
  return (
    left.stateId ===
    right.stateId
  );
}
