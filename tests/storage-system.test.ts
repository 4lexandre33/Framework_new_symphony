// @vitest-environment jsdom

import {
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  LocalDatabaseDriver,
} from "../src/engine/storage/internal/LocalDatabaseDriver";

import {
  SteamCloudDriver,
} from "../src/engine/storage/internal/SteamCloudDriver";

import {
  CloudDatabaseDriver,
} from "../src/engine/storage/internal/CloudDatabaseDriver";

import type {
  PlayerOnlineProfile,
} from "../src/contracts/storage/types";

describe(
  "Camada de Armazenamento - Drivers de Persistência",
  () => {
    let localDriver:
      LocalDatabaseDriver;

    let steamDriver:
      SteamCloudDriver;

    let cloudDriver:
      CloudDatabaseDriver;

    beforeEach((): void => {
      localStorage.clear();

      localDriver =
        new LocalDatabaseDriver();

      steamDriver =
        new SteamCloudDriver();

      cloudDriver =
        new CloudDatabaseDriver();
    });

    it(
      "deve gravar e carregar um save no banco de dados local com metadados e checksum",
      async (): Promise<void> => {
        const saveData = {
          level: 5,
          coins: 250,
          playerName:
            "Alexandre",
        };

        const metadata =
          await localDriver
            .saveGame(
              "slot_1",
              saveData,
            );

        expect(
          metadata.slotName,
        ).toBe(
          "slot_1",
        );

        expect(
          metadata.checksum,
        ).toBeDefined();

        const loaded =
          await localDriver
            .loadGame<{
              level: number;
              coins: number;
              playerName: string;
            }>(
              "slot_1",
            );

        expect(
          loaded,
        ).not.toBeNull();

        expect(
          loaded?.level,
        ).toBe(
          5,
        );

        expect(
          loaded?.coins,
        ).toBe(
          250,
        );
      },
    );

    it(
      "deve gravar e listar saves na nuvem da Steam",
      async (): Promise<void> => {
        await steamDriver
          .saveGame(
            "slot_steam_1",
            {
              progress: 80,
            },
          );

        await steamDriver
          .saveGame(
            "slot_steam_2",
            {
              progress: 95,
            },
          );

        const list =
          await steamDriver
            .listSaves();

        expect(
          list.length,
        ).toBe(
          2,
        );
      },
    );

    it(
      "deve remover um save existente e retornar verdadeiro",
      async (): Promise<void> => {
        await localDriver
          .saveGame(
            "slot_temp",
            {
              test: true,
            },
          );

        const deleted =
          await localDriver
            .deleteSave(
              "slot_temp",
            );

        expect(
          deleted,
        ).toBe(
          true,
        );

        const loaded =
          await localDriver
            .loadGame(
              "slot_temp",
            );

        expect(
          loaded,
        ).toBeNull();
      },
    );

    it(
      "deve sincronizar e consultar um perfil online no driver remoto de banco de dados",
      async (): Promise<void> => {
        const profile:
          PlayerOnlineProfile = {
            playerId:
              "player_99",

            displayName:
              "ProGamer",

            rankScore:
              1500,

            inventoryData: {
              sword:
                "excalibur",
            },

            lastSyncedTimestamp:
              Date.now(),
          };

        const synced =
          await cloudDriver
            .syncProfile(
              profile,
            );

        expect(
          synced,
        ).toBe(
          true,
        );

        const fetched =
          await cloudDriver
            .fetchProfile(
              "player_99",
            );

        expect(
          fetched,
        ).not.toBeNull();

        expect(
          fetched?.displayName,
        ).toBe(
          "ProGamer",
        );

        expect(
          fetched?.rankScore,
        ).toBe(
          1500,
        );
      },
    );
  },
);