import {
  createDomainId,
} from "../entities/DomainId";

import type {
  DomainId,
} from "../entities/DomainId";

export type SnapshotTypeId =
  DomainId<
    "snapshot-type"
  >;

export type SnapshotSlotId =
  DomainId<
    "snapshot-slot"
  >;

export function createSnapshotTypeId(
  value: string,
): SnapshotTypeId {
  return createDomainId<
    "snapshot-type"
  >(value);
}

export function createSnapshotSlotId(
  value: string,
): SnapshotSlotId {
  return createDomainId<
    "snapshot-slot"
  >(value);
}
