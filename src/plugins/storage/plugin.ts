import type {
  Plugin,
  PluginContext,
} from "@core";

import {
  LoadGameCommand,
  ProfileSyncedEvent,
  SaveCompletedEvent,
  SaveGameCommand,
  SaveRecoveredEvent,
  SyncProfileCommand,
} from "../../contracts/storage/types";

import type {
  LoadGameRequest,
  OnlineProfileEndpointConfig,
  SaveConfiguration,
  SaveGameRequest,
  SyncProfileRequest,
} from "../../contracts/storage/types";

import {
  StorageService,
} from "../../engine/storage/internal/StorageService";

import {
  SteamToken,
} from "../../tokens/steam";

import {
  StorageToken,
} from "../../tokens/storage";

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
        "game.storage.save-recovered",
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

      conflicts:
        [],
    },
  };

export interface StoragePluginOptions
  extends SaveConfiguration {
  /** Backend remoto HTTP de perfis (sem isto o online é "unsupported"). */
  readonly onlineProfile?:
    OnlineProfileEndpointConfig;
}

export function createStoragePlugin(
  options:
    StoragePluginOptions =
      {},
):
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

      storageService.configureSaves(
        options,
      );

      if (
        options.onlineProfile
      ) {
        storageService.configureOnlineProfile(
          options.onlineProfile,
        );
      }

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

      ctx.events.define(
        SaveRecoveredEvent,
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
                SaveGameRequest | undefined;

            if (
              !payload ||
              typeof payload.slotName !==
                "string" ||
              typeof payload.data !==
                "object" ||
              payload.data ===
                null
            ) {
              return null;
            }

            return await storageService
              .saveGame(
                payload.slotName,
                payload.data,
                payload.driverPreference,
                payload.options,
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
                LoadGameRequest | undefined;

            if (
              !payload ||
              typeof payload.slotName !==
                "string"
            ) {
              return null;
            }

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
                SyncProfileRequest | undefined;

            if (
              !payload?.profile
            ) {
              return false;
            }

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

          storageService
            .dispose();
        },
      );

      ctx.lifecycle.ready();
    },
  };
}
