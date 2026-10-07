import type {
  PluginContext,
} from "@core";

import type {
  PlayerOnlineProfile,
  SaveGameMetadata,
  StorageDriverType,
} from "../../../contracts/storage/types";

import type {
  StorageApi,
} from "../../../tokens/storage";

import {
  CloudDatabaseDriver,
} from "./CloudDatabaseDriver";

import {
  LocalDatabaseDriver,
} from "./LocalDatabaseDriver";

import {
  SteamCloudDriver,
} from "./SteamCloudDriver";

import {
  StorageInfrastructureError,
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

  private disposed =
    false;

  public constructor(
    private readonly ctx:
      PluginContext,

    dependencies:
      StorageServiceDependencies =
        {},
  ) {
    this.localDriver =
      dependencies.localDriver ??
      new LocalDatabaseDriver();

    this.steamDriver =
      dependencies.steamDriver ??
      new SteamCloudDriver();

    this.cloudDbDriver =
      dependencies.cloudDbDriver ??
      new CloudDatabaseDriver();

    this.now =
      dependencies.now ??
      Date.now;

    this.currentDriver =
      dependencies.initialDriver ??
      "sqlite_local";
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

  public async saveGame(
    slotName: string,
    data:
      Record<
        string,
        unknown
      >,
    driverPreference?:
      StorageDriverType,
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

    const metadata =
      await driver
        .saveGame(
          slotName,
          data,
        );

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

    return await driver
      .loadGame<T>(
        slotName,
      );
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

  public async syncOnlineProfile(
    profile:
      PlayerOnlineProfile,
  ): Promise<boolean> {
    this.assertActive(
      "profile-sync",
    );

    const success =
      await this.cloudDbDriver
        .syncProfile(
          profile,
        );

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
      },
    );

    return success;
  }

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
  }
}
