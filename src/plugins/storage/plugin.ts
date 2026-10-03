import type {
  Plugin,
  PluginContext,
} from "../../core/contracts/plugin-context";

import {
  StorageToken,
  type StorageApi,
} from "../../tokens/storage";

import {
  SteamToken,
} from "../../tokens/steam";

import {
  LoadGameCommand,
  ProfileSyncedEvent,
  SaveCompletedEvent,
  SaveGameCommand,
  SyncProfileCommand,
  type LoadGameRequest,
  type PlayerOnlineProfile,
  type SaveGameMetadata,
  type SaveGameRequest,
  type StorageDriverType,
  type SyncProfileRequest,
} from "../../contracts/storage/types";

import {
  SteamCloudDriver,
} from "../../engine/storage/SteamCloudDriver";

import {
  LocalDatabaseDriver,
} from "../../engine/storage/LocalDatabaseDriver";

import {
  CloudDatabaseDriver,
} from "../../engine/storage/CloudDatabaseDriver";

export const storageManifest:
  Plugin["manifest"] = {
    id:
      "game.storage",

    name:
      "Persistence & Database Storage Plugin",

    version:
      "1.0.0",

    kind:
      "preloaded",

    authority:
      "game",

    permissions: {
      capabilities: [
        StorageToken.id,
        SteamToken.id,
      ],

      events: [
        "game.storage.save-completed",
        "game.storage.profile-synced",
      ],
    },

    capabilities: {
      provides: [
        {
          id:
            StorageToken.id,

          version:
            "1.0.0",
        },
      ],

      consumes: [
        {
          id:
            SteamToken.id,

          range:
            "^1.0.0",

          optional:
            true,
        },
      ],
    },
  };

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

export function createStoragePlugin():
  Plugin {
  return {
    manifest:
      storageManifest,

    setup(
      ctx: PluginContext,
    ): void {
      const storageService =
        new StorageService(
          ctx,
        );

      ctx.caps.provide(
        StorageToken,
        storageService,
      );

      ctx.events.define(
        SaveCompletedEvent,
      );

      ctx.events.define(
        ProfileSyncedEvent,
      );

      ctx.commands.define(
        SaveGameCommand,
      );

      ctx.commands.define(
        LoadGameCommand,
      );

      ctx.commands.define(
        SyncProfileCommand,
      );

      const unbindSave =
        ctx.commands.handle(
          "game.storage.save-game",
          async (
            envelope,
          ) => {
            const payload =
              envelope.payload as
                SaveGameRequest;

            return await storageService
              .saveGame(
                payload.slotName,
                payload.data,
                payload.driverPreference,
              );
          },
        );

      const unbindLoad =
        ctx.commands.handle(
          "game.storage.load-game",
          async (
            envelope,
          ) => {
            const payload =
              envelope.payload as
                LoadGameRequest;

            return await storageService
              .loadGame(
                payload.slotName,
                payload.driverPreference,
              );
          },
        );

      const unbindSync =
        ctx.commands.handle(
          "game.storage.sync-profile",
          async (
            envelope,
          ) => {
            const payload =
              envelope.payload as
                SyncProfileRequest;

            return await storageService
              .syncOnlineProfile(
                payload.profile,
              );
          },
        );

      ctx.lifecycle.onDispose(
        (): void => {
          unbindSave();
          unbindLoad();
          unbindSync();
        },
      );

      ctx.lifecycle.ready();
    },
  };
}