import type {
  LoadGameResult,
  SaveGameMetadata,
  SaveGameOptions,
  SteamCloudStorageStatus,
} from "../../../contracts/storage/types";

import {
  GlobalLocalStorageBackend,
} from "./KeyValueStorageBackend";

import {
  SteamRemoteStorageBackend,
  type SteamRemoteStorageBridge,
} from "./SteamRemoteStorageBackend";

import type {
  AnyKeyValueStorageBackend,
} from "./KeyValueStorageBackend";

import {
  KeyValueSaveDriver,
  type SaveDriverConfig,
} from "./KeyValueSaveDriver";

export interface SteamCloudDriverOptions {
  /**
   * Backend fixo (testes/injeção): usado como está, SEM Steam Remote Storage
   * (status `local-fallback`, reason `custom-backend`).
   */
  readonly backend?:
    AnyKeyValueStorageBackend;

  /**
   * Backend local quando o Steam não está disponível. Com isto (e sem
   * `backend`) o driver usa o Steam Remote Storage no app nativo.
   */
  readonly localFallback?:
    AnyKeyValueStorageBackend;

  /** Ponte `steam_cloud_*` injetável (testes). */
  readonly steamBridge?:
    SteamRemoteStorageBridge;

  /** Força detectar (true) ou ignorar (false) o runtime nativo. */
  readonly nativeAvailable?:
    boolean;

  readonly now?:
    () => number;
}

/**
 * Driver `steam_cloud` (G131): grava no Steam Remote Storage (comandos
 * nativos `steam_cloud_*`) quando o cliente Steam está ativo; sem Steam cai,
 * de forma explícita (`getStatus()`), no backend local.
 */
export class SteamCloudDriver {
  private readonly driver:
    KeyValueSaveDriver;

  private readonly remote:
    SteamRemoteStorageBackend | null;

  public constructor(
    options:
      SteamCloudDriverOptions =
        {},
  ) {
    this.remote =
      options.backend ===
        undefined
        ? new SteamRemoteStorageBackend({
            fallback:
              options.localFallback ??
              new GlobalLocalStorageBackend(),
            bridge:
              options.steamBridge,
            nativeAvailable:
              options.nativeAvailable,
          })
        : null;

    this.driver =
      new KeyValueSaveDriver({
        backend:
          this.remote ??
          options.backend ??
          new GlobalLocalStorageBackend(),

        storagePrefix:
          "steam_cloud_save_",

        saveIdPrefix:
          "steam_save",

        now:
          options.now,
      });
  }

  public async getStatus():
    Promise<SteamCloudStorageStatus> {
    if (
      this.remote ===
        null
    ) {
      return {
        mode:
          "local-fallback",
        synced:
          false,
        reason:
          "custom-backend",
      };
    }

    return await this.remote.getStatus();
  }

  public configure(
    config:
      SaveDriverConfig,
  ): void {
    this.driver.configure(
      config,
    );
  }

  public saveGame(
    slotName: string,
    data:
      Record<
        string,
        unknown
      >,
    options?:
      SaveGameOptions,
  ): Promise<
    SaveGameMetadata
  > {
    return this.driver
      .saveGame(
        slotName,
        data,
        options,
      );
  }

  public loadGameDetailed<
    T =
      Record<
        string,
        unknown
      >,
  >(
    slotName: string,
  ): Promise<LoadGameResult<T>> {
    return this.driver
      .loadGameDetailed<T>(
        slotName,
      );
  }

  public loadGame<
    T =
      Record<
        string,
        unknown
      >,
  >(
    slotName: string,
  ): Promise<T | null> {
    return this.driver
      .loadGame<T>(
        slotName,
      );
  }

  public listSaves():
    Promise<
      SaveGameMetadata[]
    > {
    return this.driver
      .listSaves();
  }

  public deleteSave(
    slotName: string,
  ): Promise<boolean> {
    return this.driver
      .deleteSave(
        slotName,
      );
  }
}
