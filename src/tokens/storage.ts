import { defineCapability } from "@core";
import type {
  StorageDriverType,
  SaveGameMetadata,
  PlayerOnlineProfile,
  LoadGameResult,
  OnlineProfileBackend,
  OnlineProfileEndpointConfig,
  SaveConfiguration,
  SaveGameOptions,
  SaveMigration,
  StorageBackendInfo,
} from "../contracts/storage/types";

export interface StorageApi {
  /**
   * Driver ativo no momento para operações padrão.
   */
  readonly activeDriver: StorageDriverType;

  /**
   * Salva o estado do jogo em um slot. Qualquer nome não vazio de até 256
   * caracteres é aceito (a chave é codificada; nomes não colidem).
   * `playTimeSeconds`/`gameVersion`/`schemaVersion`/`label` vão em `options`
   * (não precisam estar em `data`). O slot anterior vira backup.
   * Falha: rejeita (`quota-exceeded`, `unavailable`...) e emite
   * `save-completed` com `success: false`.
   */
  saveGame(
    slotName: string,
    data: Record<string, unknown>,
    driverPreference?: StorageDriverType,
    options?: SaveGameOptions
  ): Promise<SaveGameMetadata>;

  /**
   * Carrega os dados (migrados para o schema atual). Ausente: null.
   * Principal corrompido: usa o backup mais recente válido (emite
   * `save-recovered`); sem backup válido rejeita `corrupted`.
   */
  loadGame<T = Record<string, unknown>>(
    slotName: string,
    driverPreference?: StorageDriverType
  ): Promise<T | null>;

  /**
   * Como `loadGame`, mas NUNCA rejeita por corrupção: devolve
   * `{ status: "ok" | "recovered" | "missing" | "corrupted", data, metadata }`.
   */
  loadGameDetailed<T = Record<string, unknown>>(
    slotName: string,
    driverPreference?: StorageDriverType
  ): Promise<LoadGameResult<T>>;

  /**
   * Lista os metadados (lidos de um índice; não lê cada save inteiro).
   */
  listSaves(driverPreference?: StorageDriverType): Promise<SaveGameMetadata[]>;

  /**
   * Remove permanentemente um save (e seus backups).
   */
  deleteSave(slotName: string, driverPreference?: StorageDriverType): Promise<boolean>;

  /**
   * Namespace por jogo, schemaVersion, gameVersion padrão, backups e chave
   * HMAC. Chame no boot, antes de salvar/carregar.
   */
  configureSaves(configuration: SaveConfiguration): void;

  /** Configuração atual (a chave HMAC nunca é devolvida). */
  getSaveConfiguration(): SaveConfiguration;

  /** Migração `fromVersion` → `fromVersion + 1` aplicada no load. */
  registerMigration(fromVersion: number, migrate: SaveMigration): void;

  /** Backend em uso; `persistent: false` = memória (node/vitest/headless). */
  getBackendInfo(): StorageBackendInfo;

  /**
   * Envia o perfil ao backend remoto. Sem backend configurado retorna false
   * e emite `profile-synced` com `error: "unsupported"` (não há online falso).
   */
  syncOnlineProfile(profile: PlayerOnlineProfile): Promise<boolean>;

  /**
   * Busca o perfil remoto. null se não existe, se houve erro ou se não há
   * backend (veja `getLastOnlineProfileError`).
   */
  fetchOnlineProfile(playerId: string): Promise<PlayerOnlineProfile | null>;

  /** true se há um backend remoto real configurado. */
  isOnlineProfileSupported(): boolean;

  getLastOnlineProfileError(): string | null;

  /** Backend remoto próprio; null volta ao padrão "unsupported". */
  setOnlineProfileBackend(backend: OnlineProfileBackend | null): void;

  /** Backend HTTP/JSON genérico: `PUT`/`GET {endpoint}/{playerId}`. */
  configureOnlineProfile(config: OnlineProfileEndpointConfig): void;

  /**
   * Define o driver principal ativo do sistema de salvamento.
   */
  setDriver(driverType: StorageDriverType): void;
}

export const StorageToken = defineCapability<StorageApi>("game.storage", "1.0.0");
