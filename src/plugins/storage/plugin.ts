import type { Plugin, PluginContext } from "@core";
import { StorageToken } from "../../tokens/storage";
import { SteamToken } from "../../tokens/steam";
import { LoadGameCommand, ProfileSyncedEvent, SaveCompletedEvent, SaveGameCommand, SyncProfileCommand, type LoadGameRequest, type SaveGameRequest, type SyncProfileRequest } from "../../contracts/storage/types";
import { StorageService } from "../../engine/storage/internal/StorageService";

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
      conflicts: [],
    },
  };

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