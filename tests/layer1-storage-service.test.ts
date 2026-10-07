import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  PluginContext,
} from "@core";

import {
  CloudDatabaseDriver,
} from "../src/engine/storage/internal/CloudDatabaseDriver";

import {
  LocalDatabaseDriver,
} from "../src/engine/storage/internal/LocalDatabaseDriver";

import {
  MemoryKeyValueStorageBackend,
} from "../src/engine/storage/internal/KeyValueStorageBackend";

import {
  SteamCloudDriver,
} from "../src/engine/storage/internal/SteamCloudDriver";

import {
  StorageInfrastructureError,
} from "../src/engine/storage/internal/StorageErrors";

import {
  StorageService,
} from "../src/engine/storage/internal/StorageService";

function createContext(): {
  readonly ctx:
    PluginContext;

  readonly events:
    Array<{
      readonly type:
        string;

      readonly payload:
        unknown;
    }>;
} {
  const events:
    Array<{
      readonly type:
        string;

      readonly payload:
        unknown;
    }> =
      [];

  const ctx = {
    events: {
      emit(
        type: string,
        payload: unknown,
      ): void {
        events.push({
          type,
          payload,
        });
      },
    },
  } as unknown as
    PluginContext;

  return {
    ctx,
    events,
  };
}

describe(
  "Layer 1 Stage 82 — StorageService",
  (): void => {
    it(
      "isola drivers local e Steam e não roteia cloud_database para local",
      async (): Promise<void> => {
        const localBackend =
          new MemoryKeyValueStorageBackend();

        const steamBackend =
          new MemoryKeyValueStorageBackend();

        const {
          ctx,
          events,
        } =
          createContext();

        const service =
          new StorageService(
            ctx,
            {
              localDriver:
                new LocalDatabaseDriver({
                  backend:
                    localBackend,

                  now:
                    (): number =>
                      100,
                }),

              steamDriver:
                new SteamCloudDriver({
                  backend:
                    steamBackend,

                  now:
                    (): number =>
                      200,
                }),

              cloudDbDriver:
                new CloudDatabaseDriver(),

              now:
                (): number =>
                  300,
            },
          );

        await service.saveGame(
          "main",
          {
            side:
              "local",
          },
          "sqlite_local",
        );

        await service.saveGame(
          "main",
          {
            side:
              "steam",
          },
          "steam_cloud",
        );

        expect(
          await service.loadGame(
            "main",
            "sqlite_local",
          ),
        ).toEqual({
          side:
            "local",
        });

        expect(
          await service.loadGame(
            "main",
            "steam_cloud",
          ),
        ).toEqual({
          side:
            "steam",
        });

        await expect(
          service.saveGame(
            "invalid",
            {},
            "cloud_database",
          ),
        ).rejects.toBeInstanceOf(
          StorageInfrastructureError,
        );

        expect(
          events.filter(
            (
              event,
            ): boolean =>
              event.type ===
              "game.storage.save-completed",
          ).length,
        ).toBe(
          2,
        );
      },
    );

    it(
      "profile backend permanece separado e falha sem derrubar o serviço",
      async (): Promise<void> => {
        const {
          ctx,
          events,
        } =
          createContext();

        const service =
          new StorageService(
            ctx,
            {
              localDriver:
                new LocalDatabaseDriver({
                  backend:
                    new MemoryKeyValueStorageBackend(),
                }),

              steamDriver:
                new SteamCloudDriver({
                  backend:
                    new MemoryKeyValueStorageBackend(),
                }),

              now:
                (): number =>
                  777,
            },
          );

        expect(
          await service
            .syncOnlineProfile({
              playerId:
                "p1",

              displayName:
                "Player",

              rankScore:
                10,

              inventoryData: {
                coins:
                  3,
              },

              lastSyncedTimestamp:
                700,
            }),
        ).toBe(
          true,
        );

        expect(
          await service
            .fetchOnlineProfile(
              "p1",
            ),
        ).toMatchObject({
          playerId:
            "p1",
        });

        expect(
          events.find(
            (
              event,
            ): boolean =>
              event.type ===
              "game.storage.profile-synced",
          ),
        ).toMatchObject({
          payload: {
            playerId:
              "p1",

            driver:
              "cloud_database",

            syncedAt:
              777,

            success:
              true,
          },
        });
      },
    );

    it(
      "dispose é idempotente e impede uso posterior do serviço",
      async (): Promise<void> => {
        const {
          ctx,
        } =
          createContext();

        const service =
          new StorageService(
            ctx,
            {
              localDriver:
                new LocalDatabaseDriver({
                  backend:
                    new MemoryKeyValueStorageBackend(),
                }),

              steamDriver:
                new SteamCloudDriver({
                  backend:
                    new MemoryKeyValueStorageBackend(),
                }),
            },
          );

        service.dispose();
        service.dispose();

        await expect(
          service.loadGame(
            "main",
          ),
        ).rejects.toMatchObject({
          code:
            "unavailable",
        });
      },
    );
  },
);
