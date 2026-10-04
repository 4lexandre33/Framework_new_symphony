import { defineEvent, defineCommand } from "@core";

export type StorageDriverType = "steam_cloud" | "sqlite_local" | "cloud_database";

export interface SaveGameMetadata {
  readonly saveId: string;
  readonly slotName: string;
  readonly playTimeSeconds: number;
  readonly timestamp: number;
  readonly gameVersion: string;
  readonly checksum: string;
}

export interface PlayerOnlineProfile {
  readonly playerId: string;
  readonly displayName: string;
  readonly rankScore: number;
  readonly inventoryData: Record<string, unknown>;
  readonly lastSyncedTimestamp: number;
}

// ── EVENTOS DE PERSISTÊNCIA ────────────────────────────────────────────────

export interface SaveCompletedPayload {
  readonly saveId: string;
  readonly slotName: string;
  readonly driver: StorageDriverType;
  readonly timestamp: number;
  readonly success: boolean;
}

export const SaveCompletedEvent = defineEvent<"game.storage.save-completed", SaveCompletedPayload>(
  "game.storage.save-completed"
);

export interface ProfileSyncedPayload {
  readonly playerId: string;
  readonly driver: StorageDriverType;
  readonly syncedAt: number;
  readonly success: boolean;
}

export const ProfileSyncedEvent = defineEvent<"game.storage.profile-synced", ProfileSyncedPayload>(
  "game.storage.profile-synced"
);

// ── COMANDOS DE PERSISTÊNCIA ───────────────────────────────────────────────

export interface SaveGameRequest {
  readonly slotName: string;
  readonly data: Record<string, unknown>;
  readonly driverPreference?: StorageDriverType;
}

export const SaveGameCommand = defineCommand<"game.storage.save-game", SaveGameRequest>(
  "game.storage.save-game"
);

export interface LoadGameRequest {
  readonly slotName: string;
  readonly driverPreference?: StorageDriverType;
}

export const LoadGameCommand = defineCommand<"game.storage.load-game", LoadGameRequest>(
  "game.storage.load-game"
);

export interface SyncProfileRequest {
  readonly profile: PlayerOnlineProfile;
}

export const SyncProfileCommand = defineCommand<"game.storage.sync-profile", SyncProfileRequest>(
  "game.storage.sync-profile"
);