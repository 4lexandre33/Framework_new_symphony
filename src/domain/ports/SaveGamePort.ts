import {
  createDomainId,
} from "../entities/DomainId";

import type {
  DomainId,
} from "../entities/DomainId";

import type {
  VersionedSnapshot,
} from "../entities/VersionedSnapshot";

import type {
  DomainResult,
} from "../evaluation/DomainResult";

export type SaveSlotId =
  DomainId<"save-slot">;

export function createSaveSlotId(
  value: string,
): SaveSlotId {
  return createDomainId<
    "save-slot"
  >(value);
}

export interface SaveGameSummary {
  readonly slotId: SaveSlotId;
  readonly schemaVersion: number;
  readonly createdAtEpochMs: number;
  readonly updatedAtEpochMs: number;
  readonly label: string | null;
}

export interface SaveGameRecord<
  TState,
> {
  readonly slotId: SaveSlotId;
  readonly snapshot:
    VersionedSnapshot<TState>;
  readonly updatedAtEpochMs: number;
  readonly label: string | null;
}

export type SaveGamePortErrorCode =
  | "unavailable"
  | "permission-denied"
  | "quota-exceeded"
  | "corrupted"
  | "operation-failed";

export interface SaveGamePortError {
  readonly code:
    SaveGamePortErrorCode;
  readonly message: string;
  readonly recoverable: boolean;
}

/**
 * Port puro de persistência de saves.
 *
 * Não assume filesystem, IndexedDB, Steam Cloud, Tauri ou qualquer formato de
 * serialização concreto. `null` em load significa slot inexistente e não erro.
 */
export interface SaveGamePort<
  TState,
> {
  listSlots(): Promise<
    DomainResult<
      readonly SaveGameSummary[],
      SaveGamePortError
    >
  >;

  load(
    slotId: SaveSlotId,
  ): Promise<
    DomainResult<
      SaveGameRecord<TState> | null,
      SaveGamePortError
    >
  >;

  save(
    slotId: SaveSlotId,
    snapshot:
      VersionedSnapshot<TState>,
    label?: string | null,
  ): Promise<
    DomainResult<
      SaveGameRecord<TState>,
      SaveGamePortError
    >
  >;

  delete(
    slotId: SaveSlotId,
  ): Promise<
    DomainResult<
      boolean,
      SaveGamePortError
    >
  >;
}
