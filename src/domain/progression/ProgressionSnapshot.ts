import {
  LevelProgression,
} from "./LevelProgression";

import type {
  LevelProgressionSnapshot,
} from "./LevelProgression";

import type {
  ProgressionCurve,
} from "./ProgressionCurve";

import {
  UnlockSet,
} from "./UnlockSet";

import type {
  UnlockSetSnapshot,
} from "./UnlockSet";

export const PROGRESSION_SNAPSHOT_SCHEMA_VERSION =
  1 as const;

export interface ProgressionSnapshot {
  readonly schemaVersion:
    typeof PROGRESSION_SNAPSHOT_SCHEMA_VERSION;
  readonly levelProgression:
    LevelProgressionSnapshot;
  readonly unlocks:
    UnlockSetSnapshot;
}

export interface RestoredProgression {
  readonly levelProgression:
    LevelProgression;
  readonly unlocks:
    UnlockSet;
}

export type ProgressionSnapshotErrorCode =
  | "unsupported-schema"
  | "invalid-snapshot";

export class ProgressionSnapshotError
  extends Error {
  public readonly name =
    "ProgressionSnapshotError";

  public constructor(
    public readonly code:
      ProgressionSnapshotErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Snapshot runtime mínimo.
 *
 * ProgressionCurve não é serializada aqui porque é definição do jogo,
 * não estado mutável da progressão.
 */
export function createProgressionSnapshot(
  levelProgression:
    LevelProgression,
  unlocks:
    UnlockSet,
): ProgressionSnapshot {
  return Object.freeze({
    schemaVersion:
      PROGRESSION_SNAPSHOT_SCHEMA_VERSION,
    levelProgression:
      levelProgression
        .toSnapshot(),
    unlocks:
      unlocks.toSnapshot(),
  });
}

export function restoreProgressionSnapshot(
  curve:
    ProgressionCurve,
  snapshot:
    ProgressionSnapshot,
): RestoredProgression {
  if (
    snapshot.schemaVersion !==
    PROGRESSION_SNAPSHOT_SCHEMA_VERSION
  ) {
    throw new ProgressionSnapshotError(
      "unsupported-schema",
      `ProgressionSnapshot schema não suportado: ${String(snapshot.schemaVersion)}.`,
    );
  }

  try {
    return Object.freeze({
      levelProgression:
        LevelProgression
          .fromSnapshot(
            curve,
            snapshot
              .levelProgression,
          ),
      unlocks:
        UnlockSet.fromSnapshot(
          snapshot.unlocks,
        ),
    });
  } catch (error) {
    throw new ProgressionSnapshotError(
      "invalid-snapshot",
      `ProgressionSnapshot inválido: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`,
    );
  }
}
