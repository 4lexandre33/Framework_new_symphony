import {
  describe,
  expect,
  it,
} from "vitest";

import {
  MemoryKeyValueStorageBackend,
} from "../src/engine/storage/internal/KeyValueStorageBackend";

import {
  LocalDatabaseDriver,
} from "../src/engine/storage/internal/LocalDatabaseDriver";

import {
  SteamCloudDriver,
} from "../src/engine/storage/internal/SteamCloudDriver";

import {
  StorageInfrastructureError,
} from "../src/engine/storage/internal/StorageErrors";

describe(
  "Layer 1 Stage 82 — storage runtime",
  (): void => {
    it(
      "persiste, valida checksum e lista saves em ordem determinística",
      async (): Promise<void> => {
        const backend =
          new MemoryKeyValueStorageBackend();

        let now =
          1000;

        const driver =
          new LocalDatabaseDriver({
            backend,
            now:
              (): number =>
                now,
          });

        await driver.saveGame(
          "slot-a",
          {
            score:
              10,
          },
        );

        now =
          2000;

        await driver.saveGame(
          "slot-b",
          {
            score:
              20,
          },
        );

        expect(
          await driver
            .loadGame<{
              score: number;
            }>(
              "slot-a",
            ),
        ).toEqual({
          score:
            10,
        });

        expect(
          (
            await driver
              .listSaves()
          ).map(
            (
              entry,
            ): string =>
              entry.slotName,
          ),
        ).toEqual([
          "slot-b",
          "slot-a",
        ]);
      },
    );

    it(
      "detecta corrupção em payload persistido",
      async (): Promise<void> => {
        const backend =
          new MemoryKeyValueStorageBackend();

        const driver =
          new LocalDatabaseDriver({
            backend,
            now:
              (): number =>
                10,
          });

        await driver.saveGame(
          "main",
          {
            coins:
              5,
          },
        );

        const key =
          backend.key(
            0,
          );

        expect(
          key,
        ).not.toBeNull();

        const raw =
          backend.getItem(
            key ??
              "",
          );

        expect(
          raw,
        ).not.toBeNull();

        const parsed =
          JSON.parse(
            raw ??
              "{}",
          ) as {
            payload: string;
          };

        parsed.payload =
          "{\"coins\":999}";

        backend.setItem(
          key ??
            "",
          JSON.stringify(
            parsed,
          ),
        );

        await expect(
          driver.loadGame(
            "main",
          ),
        ).rejects.toMatchObject({
          code:
            "corrupted",
        });
      },
    );

    it(
      "preserva leitura do container legado e não invalida saves anteriores",
      async (): Promise<void> => {
        const backend =
          new MemoryKeyValueStorageBackend();

        const payload = {
          level:
            7,
        };

        const serializedPayload =
          JSON.stringify(
            payload,
          );

        let hash =
          0;

        for (
          let index =
            0;
          index <
          serializedPayload.length;
          index +=
            1
        ) {
          const char =
            serializedPayload
              .charCodeAt(
                index,
              );

          hash =
            (
              (
                hash <<
                5
              ) -
              hash +
              char
            ) |
            0;
        }

        backend.setItem(
          "local_db_save_legacy",
          JSON.stringify({
            metadata: {
              saveId:
                "legacy_1",

              slotName:
                "legacy",

              playTimeSeconds:
                0,

              timestamp:
                1,

              gameVersion:
                "1.0.0",

              checksum:
                Math.abs(
                  hash,
                ).toString(
                  16,
                ),
            },

            data:
              payload,
          }),
        );

        const driver =
          new LocalDatabaseDriver({
            backend,
          });

        expect(
          await driver
            .loadGame(
              "legacy",
            ),
        ).toEqual(
          payload,
        );
      },
    );

    it(
      "SteamCloudDriver aceita backend injetado sem Steamworks antecipado",
      async (): Promise<void> => {
        const backend =
          new MemoryKeyValueStorageBackend();

        const driver =
          new SteamCloudDriver({
            backend,
            now:
              (): number =>
                50,
          });

        await driver.saveGame(
          "steam-main",
          {
            progress:
              0.75,
          },
        );

        expect(
          await driver
            .loadGame(
              "steam-main",
            ),
        ).toEqual({
          progress:
            0.75,
        });
      },
    );

    it(
      "backend indisponível produz erro tipado em vez de fallback volátil silencioso",
      async (): Promise<void> => {
        const previous =
          (
            globalThis as unknown as {
              localStorage?:
                unknown;
            }
          ).localStorage;

        try {
          Object.defineProperty(
            globalThis,
            "localStorage",
            {
              configurable:
                true,

              value:
                undefined,
            },
          );

          const driver =
            new LocalDatabaseDriver();

          await expect(
            driver.loadGame(
              "missing",
            ),
          ).rejects.toBeInstanceOf(
            StorageInfrastructureError,
          );
        } finally {
          Object.defineProperty(
            globalThis,
            "localStorage",
            {
              configurable:
                true,

              value:
                previous,
            },
          );
        }
      },
    );
  },
);
