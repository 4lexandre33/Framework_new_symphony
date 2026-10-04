import {
  createDefinitionId,
  createDefinitionKindId,
} from "./DefinitionId";

import type {
  DefinitionId,
  DefinitionKindId,
} from "./DefinitionId";

declare const DEFINITION_REF_TYPE:
  unique symbol;

/**
 * Referência serializável a uma definição estática.
 *
 * TDefinition existe apenas em compile-time e não adiciona wrapper runtime.
 */
export interface DefinitionRef<
  TDefinition = unknown,
> {
  readonly kindId:
    DefinitionKindId;
  readonly definitionId:
    DefinitionId;
  readonly [
    DEFINITION_REF_TYPE
  ]?: TDefinition;
}

export interface DefinitionRefSnapshot {
  readonly kindId:
    string;
  readonly definitionId:
    string;
}

export function createDefinitionRef<
  TDefinition = unknown,
>(
  kindId:
    DefinitionKindId,
  definitionId:
    DefinitionId,
): DefinitionRef<TDefinition> {
  return Object.freeze({
    kindId,
    definitionId,
  });
}

export function definitionRefToSnapshot(
  ref:
    DefinitionRef<unknown>,
): DefinitionRefSnapshot {
  return Object.freeze({
    kindId: ref.kindId,
    definitionId:
      ref.definitionId,
  });
}

export function definitionRefFromSnapshot<
  TDefinition = unknown,
>(
  snapshot:
    DefinitionRefSnapshot,
): DefinitionRef<TDefinition> {
  return createDefinitionRef<
    TDefinition
  >(
    createDefinitionKindId(
      snapshot.kindId,
    ),
    createDefinitionId(
      snapshot.definitionId,
    ),
  );
}

export function sameDefinitionRef(
  left:
    DefinitionRef<unknown>,
  right:
    DefinitionRef<unknown>,
): boolean {
  return (
    left.kindId ===
      right.kindId &&
    left.definitionId ===
      right.definitionId
  );
}
