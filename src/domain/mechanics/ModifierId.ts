import {
  createDomainId,
} from "../entities/DomainId";

import type {
  DomainId,
} from "../entities/DomainId";

export type ModifierId =
  DomainId<"modifier">;

export type ModifierTargetId =
  DomainId<"modifier-target">;

export type ModifierSourceTypeId =
  DomainId<"modifier-source-type">;

export type ModifierSourceId =
  DomainId<"modifier-source">;

export interface ModifierSourceRef {
  readonly typeId:
    ModifierSourceTypeId;
  readonly sourceId:
    ModifierSourceId;
}

export function createModifierId(
  value: string,
): ModifierId {
  return createDomainId<
    "modifier"
  >(value);
}

export function createModifierTargetId(
  value: string,
): ModifierTargetId {
  return createDomainId<
    "modifier-target"
  >(value);
}

export function createModifierSourceTypeId(
  value: string,
): ModifierSourceTypeId {
  return createDomainId<
    "modifier-source-type"
  >(value);
}

export function createModifierSourceId(
  value: string,
): ModifierSourceId {
  return createDomainId<
    "modifier-source"
  >(value);
}

export function createModifierSourceRef(
  typeId:
    ModifierSourceTypeId,
  sourceId:
    ModifierSourceId,
): ModifierSourceRef {
  return Object.freeze({
    typeId,
    sourceId,
  });
}
