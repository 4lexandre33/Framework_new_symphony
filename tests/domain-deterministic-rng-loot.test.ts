// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createCurrencyId,
  createItemId,
  createLootEntryId,
  createLootTableId,
  LootEntry,
  LootTable,
  Reward,
  RewardPolicy,
} from "../src/domain/economy";

import {
  createRandomRuntimeSnapshotCodecs,
  createRandomSeedFromString,
  createRandomStreamId,
  DeterministicRng,
  RANDOM_STREAM_SNAPSHOT_TYPE_ID,
  RandomStreamFactory,
} from "../src/domain/random";

import {
  createSnapshotSlotId,
  createStandardRuntimeSnapshotCodecs,
  DomainSnapshotRegistry,
  SnapshotCoordinator,
} from "../src/domain/snapshots";

function makeLootTable():
  LootTable {
  return new LootTable(
    createLootTableId(
      "loot-table.stage64",
    ),
    [
      new LootEntry({
        id:
          createLootEntryId(
            "loot.common",
          ),
        weight: 70,
        reward:
          new Reward({
            currencies: [
              {
                currencyId:
                  createCurrencyId(
                    "currency.coins",
                  ),
                amount: 1,
              },
            ],
          }),
      }),
      new LootEntry({
        id:
          createLootEntryId(
            "loot.rare",
          ),
        weight: 25,
        reward:
          new Reward({
            items: [
              {
                itemId:
                  createItemId(
                    "item.rare",
                  ),
                quantity: 1,
              },
            ],
          }),
      }),
      new LootEntry({
        id:
          createLootEntryId(
            "loot.epic",
          ),
        weight: 5,
        reward:
          new Reward({
            items: [
              {
                itemId:
                  createItemId(
                    "item.epic",
                  ),
                quantity: 1,
              },
            ],
          }),
      }),
    ],
  );
}

describe(
  "Etapa 64 — RNG -> LootTable",
  () => {
    it(
      "DeterministicRng satisfaz LootRandomSource por structural typing",
      () => {
        const table =
          makeLootTable();

        const seed =
          createRandomSeedFromString(
            "chest-001",
          );

        const first =
          table.roll(
            new DeterministicRng(
              seed,
            ),
            new RewardPolicy({
              rolls: 12,
            }),
          );

        const second =
          table.roll(
            new DeterministicRng(
              seed,
            ),
            new RewardPolicy({
              rolls: 12,
            }),
          );

        expect(
          first.map(
            (entry) =>
              entry.entryId,
          ),
        ).toEqual(
          second.map(
            (entry) =>
              entry.entryId,
          ),
        );
      },
    );

    it(
      "stream nomeado de loot não muda quando outro stream é consumido",
      () => {
        const table =
          makeLootTable();

        const factory =
          new RandomStreamFactory(
            createRandomSeedFromString(
              "world",
            ),
          );

        const lootA =
          factory.create(
            createRandomStreamId(
              "stream.loot",
            ),
          );

        const ai =
          factory.create(
            createRandomStreamId(
              "stream.ai",
            ),
          );

        ai.nextUint32();
        ai.nextUint32();
        ai.nextUint32();
        ai.nextUint32();

        const resultA =
          table.roll(
            lootA,
            new RewardPolicy({
              rolls: 8,
            }),
          );

        const lootB =
          new RandomStreamFactory(
            createRandomSeedFromString(
              "world",
            ),
          ).create(
            createRandomStreamId(
              "stream.loot",
            ),
          );

        const resultB =
          table.roll(
            lootB,
            new RewardPolicy({
              rolls: 8,
            }),
          );

        expect(
          resultA.map(
            (entry) =>
              entry.entryId,
          ),
        ).toEqual(
          resultB.map(
            (entry) =>
              entry.entryId,
          ),
        );
      },
    );

    it(
      "SnapshotCoordinator restaura RandomStream e continua a sequência",
      () => {
        const registry =
          new DomainSnapshotRegistry([
            ...createStandardRuntimeSnapshotCodecs(),
            ...createRandomRuntimeSnapshotCodecs(),
          ]);

        const coordinator =
          new SnapshotCoordinator(
            registry,
          );

        const stream =
          new RandomStreamFactory(
            createRandomSeedFromString(
              "snapshot-world",
            ),
          ).create(
            createRandomStreamId(
              "stream.loot",
            ),
          );

        stream.nextUint32();
        stream.nextUint32();
        stream.nextUint32();

        const slot =
          createSnapshotSlotId(
            "rng.loot",
          );

        const bundle =
          coordinator.capture([
            {
              slotId: slot,
              typeId:
                RANDOM_STREAM_SNAPSHOT_TYPE_ID,
              value: stream,
            },
          ]);

        const expected =
          Array.from(
            {
              length: 16,
            },
            () =>
              stream.nextUint32(),
          );

        const restored =
          coordinator
            .restore(bundle)
            .require<
              import(
                "../src/domain/random"
              ).RandomStream
            >(slot);

        const actual =
          Array.from(
            {
              length: 16,
            },
            () =>
              restored.nextUint32(),
          );

        expect(actual).toEqual(
          expected,
        );
      },
    );
  },
);
