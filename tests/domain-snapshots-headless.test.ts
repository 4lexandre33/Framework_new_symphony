// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  Agent,
  createAgentId,
} from "../src/domain/entities";

import {
  CurrencyAccount,
  createCurrencyId,
  createItemId,
  Inventory,
  Item,
} from "../src/domain/economy";

import {
  createQuestGoalId,
  createQuestGoalKindId,
  createQuestId,
  createStoryFlagId,
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
  createStateKey,
  StateStore,
} from "../src/domain/state";

import {
  createDomainTag,
  TagSet,
} from "../src/domain/tags";

import {
  AGENT_SNAPSHOT_TYPE_ID,
  CURRENCY_ACCOUNT_SNAPSHOT_TYPE_ID,
  createSnapshotSlotId,
  createStandardSnapshotRegistry,
  INVENTORY_SNAPSHOT_TYPE_ID,
  LEVEL_PROGRESSION_SNAPSHOT_TYPE_ID,
  NARRATIVE_STATE_SNAPSHOT_TYPE_ID,
  SnapshotCoordinator,
  STATE_STORE_SNAPSHOT_TYPE_ID,
  TAG_SET_SNAPSHOT_TYPE_ID,
  UNLOCK_SET_SNAPSHOT_TYPE_ID,
} from "../src/domain/snapshots";

describe(
  "Etapa 63 — round-trip headless de estado mutável",
  () => {
    it(
      "captura, serializa, restaura e recaptura bundle deterministicamente",
      () => {
        const coordinator =
          new SnapshotCoordinator(
            createStandardSnapshotRegistry(),
          );

        const state =
          new StateStore();

        state.set(
          createStateKey(
            "state.chapter",
          ),
          3,
        );

        const agent =
          new Agent({
            id:
              createAgentId(
                "agent.hero",
              ),
            displayName:
              "Hero",
            maxHealth: 100,
            health: 73,
            level: 2,
            experience: 120,
          });

        const potion =
          new Item({
            id:
              createItemId(
                "item.potion",
              ),
            name: "Potion",
            maxStack: 10,
          });

        const inventory =
          new Inventory({
            maxSlots: 5,
          });

        inventory.add(
          potion,
          7,
        );

        const currency =
          new CurrencyAccount({
            currencyId:
              createCurrencyId(
                "currency.coins",
              ),
            balance: 250,
          });

        const curve =
          new ProgressionCurve([
            0,
            100,
            300,
            600,
          ]);

        const progression =
          new LevelProgression(
            curve,
            350,
          );

        const unlocks =
          new UnlockSet([
            createUnlockId(
              "unlock.dash",
            ),
          ]);

        const questDefinition =
          new QuestDefinition({
            id:
              createQuestId(
                "quest.ruins",
              ),
            title:
              "Explore Ruins",
            goals: [
              {
                id:
                  createQuestGoalId(
                    "goal.enter",
                  ),
                kindId:
                  createQuestGoalKindId(
                    "goal-kind.visit",
                  ),
              },
            ],
          });

        const narrative =
          new NarrativeState([
            questDefinition,
          ]);

        narrative.activateQuest(
          questDefinition.id,
        );

        narrative.setStoryFlag(
          createStoryFlagId(
            "story.ruins-opened",
          ),
        );

        const tags =
          new TagSet([
            createDomainTag(
              "player.hero",
            ),
            createDomainTag(
              "progress.chapter-3",
            ),
          ]);

        const slots = {
          state:
            createSnapshotSlotId(
              "world.state",
            ),
          agent:
            createSnapshotSlotId(
              "player.agent",
            ),
          inventory:
            createSnapshotSlotId(
              "player.inventory",
            ),
          currency:
            createSnapshotSlotId(
              "player.currency.coins",
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
          tags:
            createSnapshotSlotId(
              "player.tags",
            ),
        } as const;

        const bindings = [
          {
            slotId:
              slots.state,
            typeId:
              STATE_STORE_SNAPSHOT_TYPE_ID,
            value: state,
          },
          {
            slotId:
              slots.agent,
            typeId:
              AGENT_SNAPSHOT_TYPE_ID,
            value: agent,
          },
          {
            slotId:
              slots.inventory,
            typeId:
              INVENTORY_SNAPSHOT_TYPE_ID,
            value: inventory,
          },
          {
            slotId:
              slots.currency,
            typeId:
              CURRENCY_ACCOUNT_SNAPSHOT_TYPE_ID,
            value: currency,
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
            value: unlocks,
          },
          {
            slotId:
              slots.narrative,
            typeId:
              NARRATIVE_STATE_SNAPSHOT_TYPE_ID,
            value: narrative,
          },
          {
            slotId:
              slots.tags,
            typeId:
              TAG_SET_SNAPSHOT_TYPE_ID,
            value: tags,
          },
        ] as const;

        const firstBundle =
          coordinator.capture(
            bindings,
          );

        const persisted =
          JSON.stringify(
            firstBundle,
          );

        state.clear();
        agent.kill();
        inventory.clear();
        currency.credit(10);
        progression.addExperience(
          50,
        );
        unlocks.clear();
        narrative.clearStoryFlag(
          createStoryFlagId(
            "story.ruins-opened",
          ),
        );
        tags.clear();

        const contexts =
          new Map([
            [
              slots.inventory,
              {
                itemDefinitions:
                  new Map([
                    [
                      potion.id,
                      potion,
                    ],
                  ]),
              },
            ],
            [
              slots.progression,
              {
                curve,
              },
            ],
            [
              slots.narrative,
              {
                questDefinitions: [
                  questDefinition,
                ],
              },
            ],
          ]);

        const restored =
          coordinator.restore(
            JSON.parse(
              persisted,
            ),
            contexts,
          );

        const restoredState =
          restored.require<
            StateStore
          >(slots.state);

        const restoredAgent =
          restored.require<
            Agent
          >(slots.agent);

        const restoredInventory =
          restored.require<
            Inventory
          >(slots.inventory);

        const restoredCurrency =
          restored.require<
            CurrencyAccount
          >(slots.currency);

        const restoredProgression =
          restored.require<
            LevelProgression
          >(slots.progression);

        const restoredUnlocks =
          restored.require<
            UnlockSet
          >(slots.unlocks);

        const restoredNarrative =
          restored.require<
            NarrativeState
          >(slots.narrative);

        const restoredTags =
          restored.require<
            TagSet
          >(slots.tags);

        expect(
          restoredState.read(
            createStateKey(
              "state.chapter",
            ),
          ),
        ).toBe(3);

        expect(
          restoredAgent
            .toSnapshot(),
        ).toEqual({
          id: "agent.hero",
          displayName: "Hero",
          health: 73,
          maxHealth: 100,
          level: 2,
          experience: 120,
          alive: true,
        });

        expect(
          restoredInventory
            .getQuantity(
              potion.id,
            ),
        ).toBe(7);

        expect(
          restoredCurrency.balance,
        ).toBe(250);

        expect(
          restoredProgression
            .totalExperience,
        ).toBe(350);

        expect(
          restoredUnlocks.has(
            createUnlockId(
              "unlock.dash",
            ),
          ),
        ).toBe(true);

        expect(
          restoredNarrative
            .hasStoryFlag(
              createStoryFlagId(
                "story.ruins-opened",
              ),
            ),
        ).toBe(true);

        expect(
          restoredTags.has(
            createDomainTag(
              "player.hero",
            ),
          ),
        ).toBe(true);

        const secondBundle =
          coordinator.capture([
            {
              slotId:
                slots.state,
              typeId:
                STATE_STORE_SNAPSHOT_TYPE_ID,
              value:
                restoredState,
            },
            {
              slotId:
                slots.agent,
              typeId:
                AGENT_SNAPSHOT_TYPE_ID,
              value:
                restoredAgent,
            },
            {
              slotId:
                slots.inventory,
              typeId:
                INVENTORY_SNAPSHOT_TYPE_ID,
              value:
                restoredInventory,
            },
            {
              slotId:
                slots.currency,
              typeId:
                CURRENCY_ACCOUNT_SNAPSHOT_TYPE_ID,
              value:
                restoredCurrency,
            },
            {
              slotId:
                slots.progression,
              typeId:
                LEVEL_PROGRESSION_SNAPSHOT_TYPE_ID,
              value:
                restoredProgression,
            },
            {
              slotId:
                slots.unlocks,
              typeId:
                UNLOCK_SET_SNAPSHOT_TYPE_ID,
              value:
                restoredUnlocks,
            },
            {
              slotId:
                slots.narrative,
              typeId:
                NARRATIVE_STATE_SNAPSHOT_TYPE_ID,
              value:
                restoredNarrative,
            },
            {
              slotId:
                slots.tags,
              typeId:
                TAG_SET_SNAPSHOT_TYPE_ID,
              value:
                restoredTags,
            },
          ]);

        expect(
          secondBundle,
        ).toEqual(
          firstBundle,
        );
      },
    );
  },
);
