import type {
  PluginContext,
} from "@core";

import type {
  LoadGameResult,
  OnlineProfileBackend,
  OnlineProfileEndpointConfig,
  PlayerOnlineProfile,
  SaveConfiguration,
  SaveGameMetadata,
  SaveGameOptions,
  SaveMigration,
  StorageBackendInfo,
  StorageBackendKind,
  StorageDriverType,
  SteamCloudStorageStatus,
} from "../../../contracts/storage/types";

import type {
  StorageApi,
} from "../../../tokens/storage";

import {
  CloudDatabaseDriver,
} from "./CloudDatabaseDriver";

import {
  DEFAULT_SAVE_DRIVER_CONFIG,
  MAX_BACKUPS,
  type SaveDriverConfig,
} from "./KeyValueSaveDriver";

import type {
  AnyKeyValueStorageBackend,
} from "./KeyValueStorageBackend";

import {
  selectDefaultKeyValueBackend,
  type ResolvedBackendInfo,
} from "./DefaultStorageBackendSelection";

import {
  LocalDatabaseDriver,
} from "./LocalDatabaseDriver";

import {
  HttpPlayerProfileBackend,
  type ProfileHttpTransport,
} from "./RemoteProfileBackend";

import {
  SteamCloudDriver,
} from "./SteamCloudDriver";

import {
  StorageInfrastructureError,
  normalizeStorageError,
} from "./StorageErrors";

type SaveStorageDriverType =
  Exclude<
    StorageDriverType,
    "cloud_database"
  >;

export interface StorageServiceDependencies {
  readonly localDriver?:
    LocalDatabaseDriver;

  readonly steamDriver?:
    SteamCloudDriver;

  readonly cloudDbDriver?:
    CloudDatabaseDriver;

  /**
   * Backend key-value dos drivers padrão (local e steam). Sem isto a engine
   * escolhe sozinha (G12/G102): Tauri → arquivo; navegador → IndexedDB;
   * senão Web Storage; senão memória.
   */
  readonly backend?:
    AnyKeyValueStorageBackend;

  /** Transporte HTTP para `configureOnlineProfile` (testes). */
  readonly profileTransport?:
    ProfileHttpTransport;

  readonly now?:
    () => number;

  readonly initialDriver?:
    SaveStorageDriverType;
}

export class StorageService
  implements StorageApi {
  private currentDriver:
    SaveStorageDriverType;

  private readonly steamDriver:
    SteamCloudDriver;

  private readonly localDriver:
    LocalDatabaseDriver;

  private readonly cloudDbDriver:
    CloudDatabaseDriver;

  private readonly now:
    () => number;

  private backendKind:
    StorageBackendKind;

  private backendPersistent:
    boolean;

  private readonly backendResolved:
    Promise<ResolvedBackendInfo> | null;

  /** Backend escolhido pela engine (fecha conexões no dispose). */
  private readonly ownedBackend:
    AnyKeyValueStorageBackend | null;

  private readonly profileTransport:
    ProfileHttpTransport | undefined;

  private config:
    SaveDriverConfig =
      DEFAULT_SAVE_DRIVER_CONFIG;

  private readonly migrations =
    new Map<
      number,
      SaveMigration
    >();

  private disposed =
    false;

  public constructor(
    private readonly ctx:
      PluginContext,

    dependencies:
      StorageServiceDependencies =
        {},
  ) {
    let backend =
      dependencies.backend;

    let kind:
      StorageBackendKind =
        "custom";

    let persistent =
      true;

    let resolved:
      Promise<ResolvedBackendInfo> | null =
        null;

    if (
      backend ===
        undefined &&
      (dependencies.localDriver ===
        undefined ||
        dependencies.steamDriver ===
          undefined)
    ) {
      const selection =
        selectDefaultKeyValueBackend();

      backend =
        selection.backend;

      kind =
        selection.kind;

      persistent =
        selection.persistent;

      resolved =
        selection.resolved;

      void resolved.then(
        (info) => {
          this.backendKind =
            info.kind;
          this.backendPersistent =
            info.persistent;
        },
      );

      if (
        !persistent &&
        kind ===
          "memory"
      ) {
        console.warn(
          "[Storage] Armazenamento persistente indisponível neste runtime: saves ficam SÓ em memória (somem ao fechar). Veja StorageApi.getBackendInfo().",
        );
      }
    }

    this.backendKind =
      kind;

    this.backendPersistent =
      persistent;

    this.backendResolved =
      resolved;

    this.ownedBackend =
      resolved !==
        null
        ? backend ??
          null
        : null;

    this.localDriver =
      dependencies.localDriver ??
      new LocalDatabaseDriver({
        backend,
        now:
          dependencies.now,
      });

    // Backend escolhido pela engine → steam_cloud usa o Steam Remote Storage
    // e cai nele só sem Steam (G131); backend injetado → usado como está.
    this.steamDriver =
      dependencies.steamDriver ??
      new SteamCloudDriver(
        dependencies.backend ===
          undefined
          ? {
              localFallback:
                backend,
              now:
                dependencies.now,
            }
          : {
              backend,
              now:
                dependencies.now,
            },
      );

    this.cloudDbDriver =
      dependencies.cloudDbDriver ??
      new CloudDatabaseDriver();

    this.profileTransport =
      dependencies.profileTransport;

    this.now =
      dependencies.now ??
      Date.now;

    this.currentDriver =
      dependencies.initialDriver ??
      "sqlite_local";

    this.applyConfig();
  }

  public get activeDriver():
    StorageDriverType {
    return this.currentDriver;
  }

  private assertActive(
    operation:
      "save"
      | "load"
      | "list"
      | "delete"
      | "profile-sync"
      | "profile-fetch",
  ): void {
    if (
      this.disposed
    ) {
      throw new StorageInfrastructureError(
        "unavailable",
        operation,
        "StorageService já foi descartado.",
        false,
      );
    }
  }

  private resolveSaveDriver(
    driver:
      StorageDriverType,
    operation:
      "save"
      | "load"
      | "list"
      | "delete",
  ):
    | LocalDatabaseDriver
    | SteamCloudDriver {
    if (
      driver ===
        "sqlite_local"
    ) {
      return this.localDriver;
    }

    if (
      driver ===
        "steam_cloud"
    ) {
      return this.steamDriver;
    }

    throw new StorageInfrastructureError(
      "operation-failed",
      operation,
      "cloud_database é exclusivo de perfis online e não pode ser usado como driver de save slots.",
      false,
    );
  }

  public setDriver(
    driverType:
      StorageDriverType,
  ): void {
    this.assertActive(
      "save",
    );

    if (
      driverType ===
        "cloud_database"
    ) {
      throw new StorageInfrastructureError(
        "operation-failed",
        "save",
        "cloud_database não é um driver de save slots.",
        false,
      );
    }

    this.currentDriver =
      driverType;
  }

  /* ─────────────────────────── configuração ─────────────────────────── */

  public configureSaves(
    configuration:
      SaveConfiguration,
  ): void {
    if (
      !configuration ||
      typeof configuration !==
        "object"
    ) {
      return;
    }

    const previous =
      this.config;

    const namespace =
      configuration.namespace ===
        undefined
        ? previous.namespace
        : typeof configuration.namespace ===
              "string" &&
            configuration.namespace.trim().length >
              0
          ? configuration.namespace.trim()
          : null;

    const backupCount =
      configuration.backupCount ===
        undefined ||
      !Number.isFinite(
        configuration.backupCount,
      )
        ? previous.backupCount
        : Math.min(
            MAX_BACKUPS,
            Math.max(
              0,
              Math.floor(
                configuration.backupCount,
              ),
            ),
          );

    const integrityKey =
      configuration.integrityKey ===
        undefined
        ? previous.integrityKey
        : typeof configuration.integrityKey ===
              "string" &&
            configuration.integrityKey.length >
              0
          ? configuration.integrityKey
          : null;

    const schemaVersion =
      configuration.schemaVersion !==
        undefined &&
      Number.isSafeInteger(
        configuration.schemaVersion,
      ) &&
      configuration.schemaVersion >=
        0
        ? configuration.schemaVersion
        : previous.schemaVersion;

    this.config = {
      namespace,

      adoptLegacySaves:
        configuration.adoptLegacySaves ??
        previous.adoptLegacySaves,

      backupCount,

      integrityKey,

      requireSignature:
        configuration.requireSignature ??
        previous.requireSignature,

      schemaVersion,

      gameVersion:
        typeof configuration.gameVersion ===
            "string" &&
          configuration.gameVersion.trim().length >
            0
          ? configuration.gameVersion
          : previous.gameVersion,

      migrations:
        this.migrations,
    };

    this.applyConfig();
  }

  public getSaveConfiguration():
    SaveConfiguration {
    return {
      namespace:
        this.config.namespace ??
        undefined,
      adoptLegacySaves:
        this.config.adoptLegacySaves,
      schemaVersion:
        this.config.schemaVersion,
      gameVersion:
        this.config.gameVersion,
      backupCount:
        this.config.backupCount,
      // A chave nunca é devolvida.
      requireSignature:
        this.config.requireSignature,
    };
  }

  /**
   * Migração `fromVersion` → `fromVersion + 1`, aplicada no load quando o
   * save é mais antigo que `configureSaves({ schemaVersion })` (G103).
   */
  public registerMigration(
    fromVersion: number,
    migrate:
      SaveMigration,
  ): void {
    if (
      !Number.isSafeInteger(
        fromVersion,
      ) ||
      fromVersion <
        0 ||
      typeof migrate !==
        "function"
    ) {
      throw new StorageInfrastructureError(
        "operation-failed",
        "load",
        "registerMigration: fromVersion inteiro >= 0 e função obrigatórios.",
        false,
      );
    }

    this.migrations.set(
      fromVersion,
      migrate,
    );
  }

  public getBackendInfo():
    StorageBackendInfo {
    return {
      kind:
        this.backendKind,
      persistent:
        this.backendPersistent,
      namespace:
        this.config.namespace,
    };
  }

  public async getSteamCloudStatus():
    Promise<SteamCloudStorageStatus> {
    return await this.steamDriver
      .getStatus();
  }

  public async resolveBackendInfo():
    Promise<StorageBackendInfo> {
    if (
      this.backendResolved !==
        null
    ) {
      // Força a sonda (uma leitura) se nenhuma operação aconteceu ainda.
      await this.localDriver
        .listSaves()
        .catch(
          () => undefined,
        );

      await this.backendResolved;
    }

    return this.getBackendInfo();
  }

  /* ──────────────────────────────── saves ───────────────────────────── */

  public async saveGame(
    slotName: string,
    data:
      Record<
        string,
        unknown
      >,
    driverPreference?:
      StorageDriverType,
    options?:
      SaveGameOptions,
  ): Promise<
    SaveGameMetadata
  > {
    this.assertActive(
      "save",
    );

    const driverType =
      driverPreference ??
      this.currentDriver;

    const driver =
      this.resolveSaveDriver(
        driverType,
        "save",
      );

    let metadata:
      SaveGameMetadata;

    try {
      metadata =
        await driver
          .saveGame(
            slotName,
            data,
            options,
          );
    } catch (
      error
    ) {
      const normalized =
        normalizeStorageError(
          error,
          "save",
          `Falha ao persistir o slot '${String(slotName)}'.`,
        );

      this.ctx.events.emit(
        "game.storage.save-completed",
        {
          saveId:
            "",

          slotName:
            String(
              slotName,
            ),

          driver:
            driverType,

          timestamp:
            this.now(),

          success:
            false,

          errorCode:
            normalized.code,
        },
      );

      throw normalized;
    }

    this.ctx.events.emit(
      "game.storage.save-completed",
      {
        saveId:
          metadata.saveId,

        slotName:
          metadata.slotName,

        driver:
          driverType,

        timestamp:
          metadata.timestamp,

        success:
          true,
      },
    );

    return metadata;
  }

  /**
   * Dados do slot (já migrados). Ausente: null. Principal corrompido: usa
   * um backup válido (emite `save-recovered`); sem backup: rejeita
   * `corrupted` — use `loadGameDetailed` para não precisar de try/catch.
   */
  public async loadGame<
    T =
      Record<
        string,
        unknown
      >,
  >(
    slotName: string,
    driverPreference?:
      StorageDriverType,
  ): Promise<T | null> {
    const result =
      await this.loadGameDetailed<T>(
        slotName,
        driverPreference,
      );

    if (
      result.status ===
        "corrupted"
    ) {
      const error =
        new StorageInfrastructureError(
          "corrupted",
          "load",
          result.error ??
            `Save '${slotName}' corrompido e sem backup válido.`,
          false,
        );

      error.reason =
        "corrupted";

      throw error;
    }

    return result.data;
  }

  public async loadGameDetailed<
    T =
      Record<
        string,
        unknown
      >,
  >(
    slotName: string,
    driverPreference?:
      StorageDriverType,
  ): Promise<LoadGameResult<T>> {
    this.assertActive(
      "load",
    );

    const driverType =
      driverPreference ??
      this.currentDriver;

    const driver =
      this.resolveSaveDriver(
        driverType,
        "load",
      );

    const result =
      await driver
        .loadGameDetailed<T>(
          slotName,
        );

    if (
      result.status ===
        "recovered"
    ) {
      this.ctx.events.emit(
        "game.storage.save-recovered",
        {
          slotName,
          driver:
            driverType,
          backupIndex:
            result.backupIndex ??
            1,
          reason:
            result.error ??
            "principal ausente ou corrompido",
        },
      );
    }

    return result;
  }

  public async listSaves(
    driverPreference?:
      StorageDriverType,
  ): Promise<
    SaveGameMetadata[]
  > {
    this.assertActive(
      "list",
    );

    const driverType =
      driverPreference ??
      this.currentDriver;

    const driver =
      this.resolveSaveDriver(
        driverType,
        "list",
      );

    return await driver
      .listSaves();
  }

  public async deleteSave(
    slotName: string,
    driverPreference?:
      StorageDriverType,
  ): Promise<boolean> {
    this.assertActive(
      "delete",
    );

    const driverType =
      driverPreference ??
      this.currentDriver;

    const driver =
      this.resolveSaveDriver(
        driverType,
        "delete",
      );

    return await driver
      .deleteSave(
        slotName,
      );
  }

  /* ──────────────────────────── perfil online ───────────────────────── */

  /**
   * Sem backend remoto configurado retorna false e emite `profile-synced`
   * com `success: false, error: "unsupported"` (G100: nada de sucesso falso).
   */
  public async syncOnlineProfile(
    profile:
      PlayerOnlineProfile,
  ): Promise<boolean> {
    this.assertActive(
      "profile-sync",
    );

    if (
      !profile ||
      typeof profile.playerId !==
        "string"
    ) {
      return false;
    }

    const success =
      await this.cloudDbDriver
        .syncProfile(
          profile,
        );

    const error =
      success
        ? null
        : this.cloudDbDriver.getLastError();

    this.ctx.events.emit(
      "game.storage.profile-synced",
      {
        playerId:
          profile.playerId,

        driver:
          "cloud_database",

        syncedAt:
          this.now(),

        success,

        ...(error !== null
          ? { error }
          : {}),
      },
    );

    return success;
  }

  /** null também quando não há backend remoto (veja `isOnlineProfileSupported`). */
  public async fetchOnlineProfile(
    playerId: string,
  ): Promise<
    PlayerOnlineProfile | null
  > {
    this.assertActive(
      "profile-fetch",
    );

    return await this.cloudDbDriver
      .fetchProfile(
        playerId,
      );
  }

  public isOnlineProfileSupported():
    boolean {
    return this.cloudDbDriver.isSupported;
  }

  /** Erro da última operação de perfil ("unsupported", HTTP 500...) ou null. */
  public getLastOnlineProfileError():
    string | null {
    return this.cloudDbDriver.getLastError();
  }

  /** Backend remoto próprio (null volta ao padrão "unsupported"). */
  public setOnlineProfileBackend(
    backend:
      OnlineProfileBackend | null,
  ): void {
    this.cloudDbDriver.setBackend(
      backend,
    );
  }

  /** Backend HTTP/JSON genérico (`PUT`/`GET {endpoint}/{playerId}`). */
  public configureOnlineProfile(
    config:
      OnlineProfileEndpointConfig,
  ): void {
    this.cloudDbDriver.setBackend(
      new HttpPlayerProfileBackend(
        config,
        this.profileTransport,
      ),
    );
  }

  public dispose():
    void {
    if (
      this.disposed
    ) {
      return;
    }

    this.disposed =
      true;

    this.cloudDbDriver
      .dispose();

    this.ownedBackend?.dispose?.();
  }

  private applyConfig():
    void {
    const config: SaveDriverConfig = {
      ...this.config,
      migrations:
        this.migrations,
    };

    this.config =
      config;

    this.localDriver.configure(
      config,
    );

    this.steamDriver.configure(
      config,
    );
  }
}
