import type { PluginContext } from "@core";
import { type StorageApi } from "../../../tokens/storage";
import { type PlayerOnlineProfile, type SaveGameMetadata, type StorageDriverType } from "../../../contracts/storage/types";
import { SteamCloudDriver } from "./SteamCloudDriver";
import { LocalDatabaseDriver } from "./LocalDatabaseDriver";
import { CloudDatabaseDriver } from "./CloudDatabaseDriver";

export class StorageService
  implements StorageApi {
  private currentDriver:
    StorageDriverType =
      "sqlite_local";

  private readonly steamDriver =
    new SteamCloudDriver();

  private readonly localDriver =
    new LocalDatabaseDriver();

  private readonly cloudDbDriver =
    new CloudDatabaseDriver();

  public constructor(
    private readonly ctx:
      PluginContext,
  ) {}

  public get activeDriver():
    StorageDriverType {
    return this.currentDriver;
  }

  public setDriver(
    driverType:
      StorageDriverType,
  ): void {
    this.currentDriver =
      driverType;

    console.log(
      `[StorageService] 🔄 Driver de armazenamento alterado para: ${driverType}`,
    );
  }

  public async saveGame(
    slotName: string,
    data:
      Record<string, unknown>,
    driverPreference?:
      StorageDriverType,
  ): Promise<SaveGameMetadata> {
    const driver =
      driverPreference ??
      this.currentDriver;

    let metadata:
      SaveGameMetadata;

    if (
      driver ===
      "steam_cloud"
    ) {
      metadata =
        await this.steamDriver
          .saveGame(
            slotName,
            data,
          );
    } else {
      metadata =
        await this.localDriver
          .saveGame(
            slotName,
            data,
          );
    }

    this.ctx.events.emit(
      "game.storage.save-completed",
      {
        saveId:
          metadata.saveId,

        slotName:
          metadata.slotName,

        driver,

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
    const driver =
      driverPreference ??
      this.currentDriver;

    if (
      driver ===
      "steam_cloud"
    ) {
      return await this.steamDriver
        .loadGame<T>(
          slotName,
        );
    }

    return await this.localDriver
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
    const driver =
      driverPreference ??
      this.currentDriver;

    if (
      driver ===
      "steam_cloud"
    ) {
      return await this.steamDriver
        .listSaves();
    }

    return await this.localDriver
      .listSaves();
  }

  public async deleteSave(
    slotName: string,
    driverPreference?:
      StorageDriverType,
  ): Promise<boolean> {
    const driver =
      driverPreference ??
      this.currentDriver;

    if (
      driver ===
      "steam_cloud"
    ) {
      return await this.steamDriver
        .deleteSave(
          slotName,
        );
    }

    return await this.localDriver
      .deleteSave(
        slotName,
      );
  }

  public async syncOnlineProfile(
    profile:
      PlayerOnlineProfile,
  ): Promise<boolean> {
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
          Date.now(),

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
    return await this.cloudDbDriver
      .fetchProfile(
        playerId,
      );
  }
}
