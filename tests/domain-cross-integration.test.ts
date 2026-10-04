// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createDomainEventId,
} from "../src/domain/events";

import {
  createConditionDefinition,
  createConditionId,
  createStateCompareCondition,
} from "../src/domain/evaluation";

import {
  Affordance,
  createInteractionActorId,
  createInteractionActorRef,
  createInteractionActorTypeId,
  createInteractionId,
  createInteractionIntent,
  createInteractionRequirement,
  createInteractionRequirementId,
  createInteractionTargetId,
  createInteractionTargetRef,
  createInteractionTargetTypeId,
} from "../src/domain/interaction";

import {
  applyProgressionUnlocks,
  createLocationEnteredEvent,
  createQuestUpdatedEvent,
  grantRewardAtomically,
  ProgressionUnlockPlan,
  projectQuestStateToState,
  resolveConditionsFromState,
  resolveInteractionWithConditions,
} from "../src/domain/integration";

import {
  createLocationId,
  createLocationRef,
} from "../src/domain/location";

import {
  createQuestGoalId,
  createQuestGoalKindId,
  createQuestId,
  QuestDefinition,
  QuestState,
} from "../src/domain/narrative";

import {
  CurrencyAccount,
  createCurrencyId,
  createItemId,
  Inventory,
  Item,
  Reward,
} from "../src/domain/economy";

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
  createSimulationTick,
} from "../src/domain/time";

describe(
  "Etapa 62 — Location -> DomainEvent",
  () => {
    it(
      "cria evento determinístico sem publicar",
      () => {
        const event =
          createLocationEnteredEvent({
            eventId:
              createDomainEventId(
                "event.location.1",
              ),
            sequence: 7,
            tick:
              createSimulationTick(
                42,
              ),
            location:
              createLocationRef(
                createLocationId(
                  "location.forest",
                ),
              ),
            previousLocation:
              createLocationRef(
                createLocationId(
                  "location.town",
                ),
              ),
          });

        expect(
          event.typeId,
        ).toBe(
          "location.entered",
        );

        expect(
          event.metadata.sequence,
        ).toBe(7);

        expect(
          event.metadata.tick,
        ).toBe(42);

        expect(
          event.metadata.source,
        ).toEqual({
          typeId: "location",
          sourceId:
            "location.forest",
        });

        expect(
          event.payload,
        ).toEqual({
          locationId:
            "location.forest",
          previousLocationId:
            "location.town",
        });
      },
    );
  },
);

describe(
  "Etapa 62 — Conditions / Interaction / State",
  () => {
    it(
      "resolve Conditions diretamente de StateStore",
      () => {
        const state =
          new StateStore();

        const hasKey =
          createStateKey<boolean>(
            "state.has-key",
          );

        state.set(
          hasKey,
          true,
        );

        const condition =
          createConditionDefinition(
            createConditionId(
              "condition.has-key",
            ),
            createStateCompareCondition(
              hasKey,
              "equals",
              true,
            ),
          );

        const result =
          resolveConditionsFromState(
            [condition],
            state,
          );

        expect(result.ok).toBe(true);

        if (!result.ok) {
          throw new Error(
            "Condition deveria resolver.",
          );
        }

        expect(
          result.value,
        ).toEqual([
          {
            conditionId:
              "condition.has-key",
            satisfied: true,
          },
        ]);
      },
    );

    it(
      "liga Affordance requirement a Condition e StateStore",
      () => {
        const state =
          new StateStore();

        const hasKey =
          createStateKey<boolean>(
            "state.has-key",
          );

        state.set(
          hasKey,
          true,
        );

        const requirementId =
          createInteractionRequirementId(
            "requirement.has-key",
          );

        const condition =
          createConditionDefinition(
            createConditionId(
              "condition.has-key",
            ),
            createStateCompareCondition(
              hasKey,
              "equals",
              true,
            ),
          );

        const interactionId =
          createInteractionId(
            "interaction.open",
          );

        const target =
          createInteractionTargetRef(
            createInteractionTargetTypeId(
              "target.door",
            ),
            createInteractionTargetId(
              "door.1",
            ),
          );

        const affordance =
          new Affordance({
            interactionId,
            target,
            requirements: [
              createInteractionRequirement(
                requirementId,
              ),
            ],
          });

        const intent =
          createInteractionIntent(
            interactionId,
            createInteractionActorRef(
              createInteractionActorTypeId(
                "actor.agent",
              ),
              createInteractionActorId(
                "agent.1",
              ),
            ),
            target,
          );

        const result =
          resolveInteractionWithConditions(
            intent,
            affordance,
            [
              {
                requirementId,
                condition,
              },
            ],
            state,
          );

        expect(result.ok).toBe(true);

        if (!result.ok) {
          throw new Error(
            "Integration deveria resolver.",
          );
        }

        expect(
          result.value.accepted,
        ).toBe(true);
      },
    );
  },
);

describe(
  "Etapa 62 — Reward -> Economy",
  () => {
    it(
      "faz grant atômico de moedas e itens",
      () => {
        const coins =
          createCurrencyId(
            "currency.coins",
          );

        const account =
          new CurrencyAccount({
            currencyId: coins,
            balance: 10,
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
            maxSlots: 2,
          });

        const reward =
          new Reward({
            currencies: [
              {
                currencyId:
                  coins,
                amount: 25,
              },
            ],
            items: [
              {
                itemId:
                  potion.id,
                quantity: 3,
              },
            ],
          });

        const result =
          grantRewardAtomically(
            reward,
            {
              inventory,
              currencyAccounts: [
                account,
              ],
              itemDefinitions:
                new Map([
                  [
                    potion.id,
                    potion,
                  ],
                ]),
            },
          );

        expect(result).toEqual({
          granted: true,
          currencyEntries: 1,
          itemEntries: 1,
          totalCurrencyUnits: 25,
          totalItemUnits: 3,
        });

        expect(
          account.balance,
        ).toBe(35);

        expect(
          inventory.getQuantity(
            potion.id,
          ),
        ).toBe(3);
      },
    );

    it(
      "rejeição de capacidade preserva todos os destinos",
      () => {
        const coins =
          createCurrencyId(
            "currency.coins",
          );

        const account =
          new CurrencyAccount({
            currencyId: coins,
            balance: 10,
          });

        const potion =
          new Item({
            id:
              createItemId(
                "item.potion",
              ),
            name: "Potion",
            maxStack: 1,
          });

        const inventory =
          new Inventory({
            maxSlots: 1,
          });

        const reward =
          new Reward({
            currencies: [
              {
                currencyId:
                  coins,
                amount: 25,
              },
            ],
            items: [
              {
                itemId:
                  potion.id,
                quantity: 2,
              },
            ],
          });

        const result =
          grantRewardAtomically(
            reward,
            {
              inventory,
              currencyAccounts: [
                account,
              ],
              itemDefinitions:
                new Map([
                  [
                    potion.id,
                    potion,
                  ],
                ]),
            },
          );

        expect(
          result.granted,
        ).toBe(false);

        expect(
          account.balance,
        ).toBe(10);

        expect(
          inventory.totalUnits,
        ).toBe(0);
      },
    );
  },
);

describe(
  "Etapa 62 — Progression -> UnlockSet",
  () => {
    it(
      "aplica somente unlocks cujo level foi alcançado",
      () => {
        const progression =
          new LevelProgression(
            new ProgressionCurve([
              0,
              100,
              250,
            ]),
            120,
          );

        const unlocks =
          new UnlockSet();

        const plan =
          new ProgressionUnlockPlan([
            {
              level: 1,
              unlockId:
                createUnlockId(
                  "unlock.start",
                ),
            },
            {
              level: 2,
              unlockId:
                createUnlockId(
                  "unlock.level-2",
                ),
            },
            {
              level: 3,
              unlockId:
                createUnlockId(
                  "unlock.level-3",
                ),
            },
          ]);

        const result =
          applyProgressionUnlocks(
            progression,
            unlocks,
            plan,
          );

        expect(
          result.currentLevel,
        ).toBe(2);

        expect(
          result.newlyUnlocked,
        ).toEqual([
          "unlock.start",
          "unlock.level-2",
        ]);

        expect(
          unlocks.has(
            createUnlockId(
              "unlock.level-3",
            ),
          ),
        ).toBe(false);
      },
    );
  },
);

describe(
  "Etapa 62 — Quest -> State / Event",
  () => {
    it(
      "projeta quest e cria DomainEvent atualizado",
      () => {
        const quest =
          new QuestState(
            new QuestDefinition({
              id:
                createQuestId(
                  "quest.demo",
                ),
              title: "Demo",
              goals: [
                {
                  id:
                    createQuestGoalId(
                      "goal.demo",
                    ),
                  kindId:
                    createQuestGoalKindId(
                      "goal-kind.demo",
                    ),
                },
              ],
            }),
          );

        quest.activate();

        const state =
          new StateStore();

        const key =
          createStateKey(
            "state.quest.demo",
          );

        projectQuestStateToState(
          quest,
          state,
          key,
        );

        expect(
          state.read(key),
        ).toMatchObject({
          questId:
            "quest.demo",
          status: "active",
        });

        const event =
          createQuestUpdatedEvent({
            eventId:
              createDomainEventId(
                "event.quest.1",
              ),
            sequence: 8,
            tick:
              createSimulationTick(
                43,
              ),
            quest,
            previousStatus:
              "inactive",
          });

        expect(
          event.typeId,
        ).toBe(
          "quest.updated",
        );

        expect(
          event.metadata.source,
        ).toEqual({
          typeId: "quest",
          sourceId:
            "quest.demo",
        });
      },
    );
  },
);
