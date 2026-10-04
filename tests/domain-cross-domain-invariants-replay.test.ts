// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  CurrencyAccount,
  createCurrencyId,
  createItemId,
  createLootEntryId,
  createLootTableId,
  Inventory,
  Item,
  LootEntry,
  LootTable,
  Reward,
  RewardPolicy,
} from "../src/domain/economy";

import {
  applyProgressionUnlocks,
  grantRewardAtomically,
  ProgressionUnlockPlan,
  projectQuestStateToState,
} from "../src/domain/integration";

import {
  createQuestGoalId,
  createQuestGoalKindId,
  createQuestId,
  NarrativeState,
  QuestDefinition,
} from "../src/domain/narrative";

import {
  createUnlockId,
  LevelProgression,
  ProgressionCurve,
  UnlockSet,
} from "../src/domain/progression";

import {
  createRandomRuntimeSnapshotCodecs,
  createRandomSeedFromString,
  createRandomStreamId,
  RANDOM_STREAM_SNAPSHOT_TYPE_ID,
  RandomStream,
  RandomStreamFactory,
} from "../src/domain/random";

import {
  createSnapshotSlotId,
  createStandardRuntimeSnapshotCodecs,
  CURRENCY_ACCOUNT_SNAPSHOT_TYPE_ID,
  DomainSnapshotRegistry,
  INVENTORY_SNAPSHOT_TYPE_ID,
  LEVEL_PROGRESSION_SNAPSHOT_TYPE_ID,
  NARRATIVE_STATE_SNAPSHOT_TYPE_ID,
  SnapshotCoordinator,
  STATE_STORE_SNAPSHOT_TYPE_ID,
  UNLOCK_SET_SNAPSHOT_TYPE_ID,
} from "../src/domain/snapshots";

import {
  createStateKey,
  StateStore,
} from "../src/domain/state";

function makeItem():
  Item {
  return new Item({
    id:
      createItemId(
        "item.relic",
      ),
    name: "Relic",
    maxStack: 5,
  });
}

function makeQuestDefinition():
  QuestDefinition {
  return new QuestDefinition({
    id:
      createQuestId(
        "quest.relic",
      ),
    title:
      "Recover Relic",
    goals: [
      {
        id:
          createQuestGoalId(
            "goal.relic",
          ),
        kindId:
          createQuestGoalKindId(
            "goal-kind.collect",
          ),
      },
    ],
  });
}

function makeLootTable(
  item: Item,
  currencyId:
    ReturnType<
      typeof createCurrencyId
    >,
): LootTable {
  return new LootTable(
    createLootTableId(
      "loot.relic-chest",
    ),
    [
      new LootEntry({
        id:
          createLootEntryId(
            "loot.coins",
          ),
        weight: 60,
        reward:
          new Reward({
            currencies: [
              {
                currencyId,
                amount: 10,
              },
            ],
          }),
      }),
      new LootEntry({
        id:
          createLootEntryId(
            "loot.relic",
          ),
        weight: 40,
        reward:
          new Reward({
            items: [
              {
                itemId:
                  item.id,
                quantity: 1,
              },
            ],
          }),
      }),
    ],
  );
}

function makeSnapshotRegistry():
  DomainSnapshotRegistry {
  return new DomainSnapshotRegistry([
    ...createStandardRuntimeSnapshotCodecs(),
    ...createRandomRuntimeSnapshotCodecs(),
  ]);
}

describe(
  "Etapa 68 — Snapshot/RNG/replay invariants",
  () => {
    // @invariant XINV008
    it(
      "XINV008 — restore preserva snapshot mas cria aggregates isolados",
      () => {
        const item =
          makeItem();

        const inventory =
          new Inventory({
            maxSlots: 8,
          });

        inventory.add(
          item,
          2,
        );

        const currency =
          new CurrencyAccount({
            currencyId:
              createCurrencyId(
                "currency.coins",
              ),
            balance: 100,
          });

        const state =
          new StateStore();

        const stateKey =
          createStateKey<number>(
            "state.chapter",
          );

        state.set(
          stateKey,
          4,
        );

        const coordinator =
          new SnapshotCoordinator(
            makeSnapshotRegistry(),
          );

        const inventorySlot =
          createSnapshotSlotId(
            "player.inventory",
          );

        const currencySlot =
          createSnapshotSlotId(
            "player.currency",
          );

        const stateSlot =
          createSnapshotSlotId(
            "world.state",
          );

        const bundle =
          coordinator.capture([
            {
              slotId:
                inventorySlot,
              typeId:
                INVENTORY_SNAPSHOT_TYPE_ID,
              value:
                inventory,
            },
            {
              slotId:
                currencySlot,
              typeId:
                CURRENCY_ACCOUNT_SNAPSHOT_TYPE_ID,
              value:
                currency,
            },
            {
              slotId:
                stateSlot,
              typeId:
                STATE_STORE_SNAPSHOT_TYPE_ID,
              value:
                state,
            },
          ]);

        const restored =
          coordinator.restore(
            JSON.parse(
              JSON.stringify(
                bundle,
              ),
            ),
            new Map([
              [
                inventorySlot,
                {
                  itemDefinitions:
                    new Map([
                      [
                        item.id,
                        item,
                      ],
                    ]),
                },
              ],
            ]),
          );

        const restoredInventory =
          restored.require<
            Inventory
          >(inventorySlot);

        const restoredCurrency =
          restored.require<
            CurrencyAccount
          >(currencySlot);

        const restoredState =
          restored.require<
            StateStore
          >(stateSlot);

        expect(
          restoredInventory,
        ).not.toBe(
          inventory,
        );

        expect(
          restoredCurrency,
        ).not.toBe(
          currency,
        );

        expect(
          restoredState,
        ).not.toBe(
          state,
        );

        expect(
          restoredInventory
            .toSnapshot(),
        ).toEqual(
          inventory.toSnapshot(),
        );

        expect(
          restoredCurrency
            .toSnapshot(),
        ).toEqual(
          currency.toSnapshot(),
        );

        expect(
          restoredState
            .toSnapshot(),
        ).toEqual(
          state.toSnapshot(),
        );

        restoredInventory.remove(
          item.id,
          1,
        );

        restoredCurrency.credit(
          50,
        );

        restoredState.set(
          stateKey,
          9,
        );

        expect(
          inventory.getQuantity(
            item.id,
          ),
        ).toBe(2);

        expect(
          currency.balance,
        ).toBe(100);

        expect(
          state.read(stateKey),
        ).toBe(4);
      },
    );

    // @invariant XINV009
    it(
      "XINV009 — stream de Loot é isolado e restore continua a sequência",
      () => {
        const item =
          makeItem();

        const currencyId =
          createCurrencyId(
            "currency.coins",
          );

        const table =
          makeLootTable(
            item,
            currencyId,
          );

        const rootSeed =
          createRandomSeedFromString(
            "world-stage68",
          );

        const factory =
          new RandomStreamFactory(
            rootSeed,
          );

        const loot =
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

        for (
          let index = 0;
          index < 25;
          index += 1
        ) {
          ai.nextUint32();
        }

        const firstRoll =
          table.roll(
            loot,
            new RewardPolicy({
              rolls: 8,
            }),
          )
            .map(
              (entry) =>
                entry.entryId,
            );

        const cleanLoot =
          new RandomStreamFactory(
            createRandomSeedFromString(
              "world-stage68",
            ),
          ).create(
            createRandomStreamId(
              "stream.loot",
            ),
          );

        const controlRoll =
          table.roll(
            cleanLoot,
            new RewardPolicy({
              rolls: 8,
            }),
          )
            .map(
              (entry) =>
                entry.entryId,
            );

        expect(firstRoll)
          .toEqual(
            controlRoll,
          );

        const coordinator =
          new SnapshotCoordinator(
            makeSnapshotRegistry(),
          );

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
              value: loot,
            },
          ]);

        const expected =
          Array.from(
            {
              length: 20,
            },
            () =>
              loot.nextUint32(),
          );

        const restored =
          coordinator
            .restore(bundle)
            .require<
              RandomStream
            >(slot);

        const actual =
          Array.from(
            {
              length: 20,
            },
            () =>
              restored.nextUint32(),
          );

        expect(actual).toEqual(
          expected,
        );
      },
    );

    // @invariant XINV010
    it(
      "XINV010 — mesmos inputs reproduzem o mesmo outcome cross-domain headless",
      () => {
        function runScenario(
          seedText: string,
        ) {
          const item =
            makeItem();

          const currencyId =
            createCurrencyId(
              "currency.coins",
            );

          const account =
            new CurrencyAccount({
              currencyId,
              balance: 5,
            });

          const inventory =
            new Inventory({
              maxSlots: 20,
            });

          const lootStream =
            new RandomStreamFactory(
              createRandomSeedFromString(
                seedText,
              ),
            ).create(
              createRandomStreamId(
                "stream.loot",
              ),
            );

          const lootResults =
            makeLootTable(
              item,
              currencyId,
            ).roll(
              lootStream,
              new RewardPolicy({
                rolls: 12,
              }),
            );

          for (
            const rolled of
            lootResults
          ) {
            const grant =
              grantRewardAtomically(
                rolled.reward,
                {
                  inventory,
                  currencyAccounts: [
                    account,
                  ],
                  itemDefinitions:
                    new Map([
                      [
                        item.id,
                        item,
                      ],
                    ]),
                },
              );

            if (!grant.granted) {
              throw new Error(
                `Reward inesperadamente rejeitado: ${grant.reason}`,
              );
            }
          }

          const progression =
            new LevelProgression(
              new ProgressionCurve([
                0,
                100,
                250,
                500,
              ]),
          );

          progression.addExperience(
            lootResults.length *
              25,
          );

          const unlocks =
            new UnlockSet();

          applyProgressionUnlocks(
            progression,
            unlocks,
            new ProgressionUnlockPlan([
              {
                level: 2,
                unlockId:
                  createUnlockId(
                    "unlock.chapter-2",
                  ),
              },
              {
                level: 3,
                unlockId:
                  createUnlockId(
                    "unlock.chapter-3",
                  ),
              },
            ]),
          );

          const questDefinition =
            makeQuestDefinition();

          const narrative =
            new NarrativeState([
              questDefinition,
            ]);

          narrative.activateQuest(
            questDefinition.id,
          );

          if (
            inventory.has(
              item.id,
            )
          ) {
            narrative.completeQuestGoal(
              questDefinition.id,
              createQuestGoalId(
                "goal.relic",
              ),
            );
          }

          const state =
            new StateStore();

          projectQuestStateToState(
            narrative.getQuest(
              questDefinition.id,
            ),
            state,
            createStateKey(
              "state.quest.relic",
            ),
          );

          const coordinator =
            new SnapshotCoordinator(
              makeSnapshotRegistry(),
            );

          const slots = {
            state:
              createSnapshotSlotId(
                "world.state",
              ),
            inventory:
              createSnapshotSlotId(
                "player.inventory",
              ),
            currency:
              createSnapshotSlotId(
                "player.currency",
              ),
            progression:
              createSnapshotSlotId(
                "player.progression",
              ),
            unlocks:
              createSnapshotSlotId(
                "player.unlocks",
              ),
            narrative:
              createSnapshotSlotId(
                "world.narrative",
              ),
            rng:
              createSnapshotSlotId(
                "rng.loot",
              ),
          } as const;

          const bundle =
            coordinator.capture([
              {
                slotId:
                  slots.state,
                typeId:
                  STATE_STORE_SNAPSHOT_TYPE_ID,
                value: state,
              },
              {
                slotId:
                  slots.inventory,
                typeId:
                  INVENTORY_SNAPSHOT_TYPE_ID,
                value:
                  inventory,
              },
              {
                slotId:
                  slots.currency,
                typeId:
                  CURRENCY_ACCOUNT_SNAPSHOT_TYPE_ID,
                value:
                  account,
              },
              {
                slotId:
                  slots.progression,
                typeId:
                  LEVEL_PROGRESSION_SNAPSHOT_TYPE_ID,
                value:
                  progression,
              },
              {
                slotId:
                  slots.unlocks,
                typeId:
                  UNLOCK_SET_SNAPSHOT_TYPE_ID,
                value:
                  unlocks,
              },
              {
                slotId:
                  slots.narrative,
                typeId:
                  NARRATIVE_STATE_SNAPSHOT_TYPE_ID,
                value:
                  narrative,
              },
              {
                slotId:
                  slots.rng,
                typeId:
                  RANDOM_STREAM_SNAPSHOT_TYPE_ID,
                value:
                  lootStream,
              },
            ]);

          return Object.freeze({
            lootEntryIds:
              Object.freeze(
                lootResults.map(
                  (entry) =>
                    entry.entryId,
                ),
              ),
            inventory:
              inventory.toSnapshot(),
            currency:
              account.toSnapshot(),
            progression:
              progression.toSnapshot(),
            unlocks:
              unlocks.toSnapshot(),
            narrative:
              narrative.toSnapshot(),
            state:
              state.toSnapshot(),
            bundle,
          });
        }

        const first =
          runScenario(
            "replay-stage68",
          );

        const second =
          runScenario(
            "replay-stage68",
          );

        expect(second)
          .toEqual(first);

        expect(
          JSON.stringify(
            second.bundle,
          ),
        ).toBe(
          JSON.stringify(
            first.bundle,
          ),
        );
      },
    );
  },
);
