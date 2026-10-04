import {
  createSnapshotSlotId,
  createSnapshotTypeId,
} from "./SnapshotIds";

import type {
  SnapshotSlotId,
  SnapshotTypeId,
} from "./SnapshotIds";

import {
  cloneSnapshotValue,
} from "./SnapshotValue";

import type {
  SnapshotValue,
} from "./SnapshotValue";

export const SNAPSHOT_BUNDLE_SCHEMA_VERSION =
  1 as const;

export interface SnapshotBundleEntryInput {
  readonly slotId:
    SnapshotSlotId;
  readonly typeId:
    SnapshotTypeId;
  readonly schemaVersion:
    number;
  readonly state:
    unknown;
}

export interface SnapshotBundleEntry {
  readonly slotId:
    string;
  readonly typeId:
    string;
  readonly schemaVersion:
    number;
  readonly state:
    SnapshotValue;
}

export interface SnapshotBundleSnapshot {
  readonly schemaVersion:
    typeof SNAPSHOT_BUNDLE_SCHEMA_VERSION;
  readonly entries:
    readonly SnapshotBundleEntry[];
}

export type SnapshotBundleErrorCode =
  | "invalid-bundle"
  | "unsupported-bundle-schema"
  | "invalid-entry"
  | "invalid-schema-version"
  | "duplicate-slot";

export class SnapshotBundleError
  extends Error {
  public readonly name =
    "SnapshotBundleError";

  public constructor(
    public readonly code:
      SnapshotBundleErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function isPlainObject(
  value: unknown,
): value is Record<
  string,
  unknown
> {
  if (
    typeof value !==
      "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return false;
  }

  const prototype =
    Object.getPrototypeOf(
      value,
    );

  return (
    prototype ===
      Object.prototype ||
    prototype === null
  );
}

function assertEntrySchemaVersion(
  value: unknown,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(
      value,
    ) ||
    value < 1
  ) {
    throw new SnapshotBundleError(
      "invalid-schema-version",
      "Snapshot bundle entry schemaVersion deve ser inteiro seguro >= 1.",
    );
  }

  return value;
}

function compareEntry(
  left:
    SnapshotBundleEntry,
  right:
    SnapshotBundleEntry,
): number {
  return left.slotId <
    right.slotId
    ? -1
    : left.slotId >
        right.slotId
      ? 1
      : 0;
}

function normalizeEntry(
  value: unknown,
): SnapshotBundleEntry {
  if (!isPlainObject(value)) {
    throw new SnapshotBundleError(
      "invalid-entry",
      "Snapshot bundle entry deve ser objeto simples.",
    );
  }

  if (
    typeof value.slotId !==
      "string" ||
    typeof value.typeId !==
      "string"
  ) {
    throw new SnapshotBundleError(
      "invalid-entry",
      "Snapshot bundle entry exige slotId/typeId string.",
    );
  }

  const slotId =
    createSnapshotSlotId(
      value.slotId,
    );

  const typeId =
    createSnapshotTypeId(
      value.typeId,
    );

  const schemaVersion =
    assertEntrySchemaVersion(
      value.schemaVersion,
    );

  const state =
    cloneSnapshotValue(
      value.state,
    );

  return Object.freeze({
    slotId,
    typeId,
    schemaVersion,
    state,
  });
}

/**
 * Valida, clona e ordena um bundle vindo de memória ou JSON.parse().
 */
export function normalizeSnapshotBundle(
  value: unknown,
): SnapshotBundleSnapshot {
  if (!isPlainObject(value)) {
    throw new SnapshotBundleError(
      "invalid-bundle",
      "Snapshot bundle deve ser objeto simples.",
    );
  }

  if (
    value.schemaVersion !==
    SNAPSHOT_BUNDLE_SCHEMA_VERSION
  ) {
    throw new SnapshotBundleError(
      "unsupported-bundle-schema",
      `Snapshot bundle schema não suportado: "${String(value.schemaVersion)}".`,
    );
  }

  if (
    !Array.isArray(
      value.entries,
    )
  ) {
    throw new SnapshotBundleError(
      "invalid-bundle",
      "Snapshot bundle entries deve ser array.",
    );
  }

  const seen =
    new Set<SnapshotSlotId>();

  const entries:
    SnapshotBundleEntry[] =
      [];

  for (
    const rawEntry of
    value.entries
  ) {
    const entry =
      normalizeEntry(
        rawEntry,
      );

    const slotId =
      createSnapshotSlotId(
        entry.slotId,
      );

    if (seen.has(slotId)) {
      throw new SnapshotBundleError(
        "duplicate-slot",
        `SnapshotSlotId duplicado no bundle: "${slotId}".`,
      );
    }

    seen.add(slotId);
    entries.push(entry);
  }

  entries.sort(compareEntry);

  return Object.freeze({
    schemaVersion:
      SNAPSHOT_BUNDLE_SCHEMA_VERSION,
    entries:
      Object.freeze(entries),
  });
}

export function createSnapshotBundle(
  entries:
    readonly SnapshotBundleEntryInput[],
): SnapshotBundleSnapshot {
  return normalizeSnapshotBundle({
    schemaVersion:
      SNAPSHOT_BUNDLE_SCHEMA_VERSION,
    entries,
  });
}
