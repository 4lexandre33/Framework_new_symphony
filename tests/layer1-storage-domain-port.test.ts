import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  PluginContext,
} from "@core";

import {
  createSaveSlotId,
} from "../src/domain/ports/SaveGamePort";

import type {
  DomainSaveState,
} from "../src/domain/ports/DomainSaveGamePort";

import {
  DomainSaveGamePortAdapter,
} from "../src/engine/storage/internal/DomainSaveGamePortAdapter";

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
  StorageService,
} from "../src/engine/storage/internal/StorageService";

function createContext():
  PluginContext {
  return {
    events: {
      emit:
        (): void => {},
    },
  } as unknown as
    PluginContext;
}

describe(
  "Layer 1 Stage 82 — DomainSaveGamePort adapter",
  (): void => {
    it(
      "implementa o port da Camada 2 sem fazer Domain depender da Engine",
      async (): Promise<void> => {
        const backend =
          new MemoryKeyValueStorageBackend();

        let now =
          200;

        const storage =
          new StorageService(
            createContext(),
            {
              localDriver:
                new LocalDatabaseDriver({
                  backend,
                  now:
                    (): number =>
                      now,
                }),

              steamDriver:
                new SteamCloudDriver({
                  backend:
                    new MemoryKeyValueStorageBackend(),
                }),
            },
          );

        const port =
          new DomainSaveGamePortAdapter(
            storage,
          );

        const slotId =
          createSaveSlotId(
            "campaign-1",
          );

        const state =
          {
            schemaVersion:
              1,

            entries:
              [],
          } as unknown as
            DomainSaveState;

        const saved =
          await port.save(
            slotId,
            {
              schemaVersion:
                3,

              createdAtEpochMs:
                100,

              state,
            },
            "Campanha principal",
          );

        expect(
          saved.ok,
        ).toBe(
          true,
        );

        now =
          500;

        const loaded =
          await port.load(
            slotId,
          );

        expect(
          loaded.ok,
        ).toBe(
          true,
        );

        if (
          !loaded.ok ||
          loaded.value ===
            null
        ) {
          throw new Error(
            "Save deveria existir.",
          );
        }

        expect(
          loaded.value
            .snapshot
            .schemaVersion,
        ).toBe(
          3,
        );

        expect(
          loaded.value
            .label,
        ).toBe(
          "Campanha principal",
        );

        const listed =
          await port
            .listSlots();

        expect(
          listed.ok,
        ).toBe(
          true,
        );

        if (
          !listed.ok
        ) {
          throw new Error(
            "Listagem deveria ser válida.",
          );
        }

        expect(
          listed.value,
        ).toHaveLength(
          1,
        );

        expect(
          listed.value[
            0
          ]?.createdAtEpochMs,
        ).toBe(
          100,
        );

        expect(
          await port.delete(
            slotId,
          ),
        ).toEqual({
          ok:
            true,

          value:
            true,
        });
      },
    );
  },
);
