import { defineEvent, defineCommand } from "@core";

export type StorageDriverType = "steam_cloud" | "sqlite_local" | "cloud_database";

/**
 * Metadados de um save. São calculados pela engine: `playTimeSeconds` e
 * `gameVersion` vêm de `SaveGameOptions` (ou, por compatibilidade, do topo de
 * `data`; senão 0 / versão padrão configurada). NÃO é preciso colocá-los em
 * `data`.
 */
export interface SaveGameMetadata {
  readonly saveId: string;
  readonly slotName: string;
  readonly playTimeSeconds: number;
  readonly timestamp: number;
  readonly gameVersion: string;
  /** Checksum de integridade (FNV-1a) do payload. Não é assinatura. */
  readonly checksum: string;
  /** Versão do schema do jogo gravada com o save (migrações). */
  readonly schemaVersion?: number;
  /** Rótulo livre para a UI de saves. */
  readonly label?: string;
  /** true se o save tem assinatura HMAC (chave configurada no momento do save). */
  readonly signed?: boolean;
}

export interface SaveGameOptions {
  readonly playTimeSeconds?: number;
  readonly gameVersion?: string;
  /** Padrão: a versão configurada em `configureSaves({ schemaVersion })`. */
  readonly schemaVersion?: number;
  readonly label?: string;
}

/**
 * Migração de schema: recebe os dados na versão `fromVersion` e devolve os
 * dados na versão `fromVersion + 1`.
 */
export type SaveMigration = (
  data: Record<string, unknown>,
) => Record<string, unknown>;

export interface SaveConfiguration {
  /**
   * Namespace do jogo (G32/G102): isola as chaves de save entre jogos que
   * compartilham o mesmo armazenamento. Recomendo o id do projeto.
   */
  readonly namespace?: string;
  /** Com namespace novo: lê saves antigos (sem namespace) do mesmo slot e os adota. */
  readonly adoptLegacySaves?: boolean;
  /** Versão atual do schema dos dados do jogo (migrações rodam no load). */
  readonly schemaVersion?: number;
  /** `gameVersion` padrão dos metadados. */
  readonly gameVersion?: string;
  /** Quantas cópias anteriores manter por slot para recuperação (0–5, padrão 1). */
  readonly backupCount?: number;
  /**
   * Chave para assinar saves com HMAC-SHA256 (detecta adulteração casual).
   * ATENÇÃO: no cliente a chave é extraível; NÃO é segurança contra
   * trapaça — dados competitivos devem ser validados por um servidor.
   * `null` remove a chave.
   */
  readonly integrityKey?: string | null;
  /** Com chave: rejeitar saves sem assinatura (padrão false: aceita e re-assina no próximo save). */
  readonly requireSignature?: boolean;
}

/**
 * Backend dos saves. Seleção automática: app Tauri → `tauri-file`
 * (`<app_data_dir>/storage/saves/`); navegador → `indexeddb`; senão
 * `local-storage`; senão `memory` (não persistente).
 */
export type StorageBackendKind = "tauri-file" | "indexeddb" | "local-storage" | "memory" | "custom";

export interface StorageBackendInfo {
  readonly kind: StorageBackendKind;
  /** false = os dados somem ao fechar (backend em memória). */
  readonly persistent: boolean;
  readonly namespace: string | null;
}

export type LoadGameStatus = "ok" | "recovered" | "missing" | "corrupted";

export interface LoadGameResult<T> {
  readonly status: LoadGameStatus;
  /** Dados (já migrados); null em "missing"/"corrupted". */
  readonly data: T | null;
  readonly metadata: SaveGameMetadata | null;
  /** "recovered": índice do backup usado (1 = mais recente). */
  readonly backupIndex?: number;
  /** Versões de schema migradas (ex.: [1, 2] = 1→2→3). */
  readonly migratedFrom?: ReadonlyArray<number>;
  /** Motivo da corrupção do slot principal (quando houve). */
  readonly error?: string;
}

/**
 * Backend remoto de perfis (G100). Lance erro em falhas. `supported: false`
 * indica "sem online" (o padrão da engine).
 */
export interface OnlineProfileBackend {
  readonly supported?: boolean;
  write(profile: PlayerOnlineProfile): Promise<void>;
  read(playerId: string): Promise<PlayerOnlineProfile | null>;
  dispose?(): void;
}

export interface OnlineProfileEndpointConfig {
  /** URL base; o perfil fica em `${endpoint}/${encodeURIComponent(playerId)}`. */
  readonly endpoint: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
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
  /** Em falha: código do erro ("quota-exceeded", "unavailable"...). */
  readonly errorCode?: string;
}

export const SaveCompletedEvent = defineEvent<"game.storage.save-completed", SaveCompletedPayload>(
  "game.storage.save-completed"
);

export interface ProfileSyncedPayload {
  readonly playerId: string;
  readonly driver: StorageDriverType;
  readonly syncedAt: number;
  readonly success: boolean;
  /** Em falha: "unsupported" (sem backend remoto configurado) ou a mensagem do erro. */
  readonly error?: string;
}

export const ProfileSyncedEvent = defineEvent<"game.storage.profile-synced", ProfileSyncedPayload>(
  "game.storage.profile-synced"
);

export interface SaveRecoveredPayload {
  readonly slotName: string;
  readonly driver: StorageDriverType;
  /** 1 = backup mais recente. */
  readonly backupIndex: number;
  readonly reason: string;
}

/** O slot principal estava corrompido e um backup foi usado. */
export const SaveRecoveredEvent = defineEvent<"game.storage.save-recovered", SaveRecoveredPayload>(
  "game.storage.save-recovered"
);

// ── COMANDOS DE PERSISTÊNCIA ───────────────────────────────────────────────

export interface SaveGameRequest {
  readonly slotName: string;
  readonly data: Record<string, unknown>;
  readonly driverPreference?: StorageDriverType;
  readonly options?: SaveGameOptions;
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