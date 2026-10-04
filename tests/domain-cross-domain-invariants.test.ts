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
  Inventory,
  Item,
  Reward,
} from "../src/domain/economy";

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
  advanceStatusEffectsByTime,
  applyProgressionUnlocks,
  createLocationEnteredEvent,
  createQuestStateProjection,
  createQuestUpdatedEvent,
  grantRewardAtomically,
  ProgressionUnlockPlan,
  projectQuestStateToState,
  resolveInteractionWithConditions,
} from "../src/domain/integration";

import {
  createLocationId,
  createLocationRef,
} from "../src/domain/location";

import {
  createStatusEffectId,
  createStatusEffectInstanceId,
  StatusEffect,
  StatusEffectSet,
} from "../src/domain/mechanics";

import {
  createQuestGoalId,
  createQuestGoalKindId,
  createQuestId,
  QuestDefinition,
  QuestState,
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
  createDomainDuration,
  createSimulationTick,
} from "../src/domain/time";

describe(
  "Etapa 68 — Cross-domain invariants fundamentais",
  () => {
    // @invariant XINV001
    it(
      "XINV001 — rejeição de Reward é atômica entre CurrencyAccount e Inventory",
      () => {
        const currencyId =
          createCurrencyId(
            "currency.coins",
          );

        const account =
          new CurrencyAccount({
            currencyId,
            balance: 10,
          });

        const item =
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
                currencyId,
                amount: 25,
              },
            ],
            items: [
              {
                itemId:
                  item.id,
                quantity: 2,
              },
            ],
          });

        const beforeCurrency =
          account.toSnapshot();

        const beforeInventory =
          inventory.toSnapshot();

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
                    item.id,
                    item,
                  ],
                ]),
            },
          );

        expect(
          result.granted,
        ).toBe(false);

        expect(
          account.toSnapshot(),
        ).toEqual(
          beforeCurrency,
        );

        expect(
          inventory.toSnapshot(),
        ).toEqual(
          beforeInventory,
        );
      },
    );

    // @invariant XINV002
    it(
      "XINV002 — Reward aceito aplica exatamente os deltas declarados",
      () => {
        const currencyId =
          createCurrencyId(
            "currency.coins",
          );

        const account =
          new CurrencyAccount({
            currencyId,
            balance: 100,
          });

        const item =
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
            maxSlots: 4,
          });

        inventory.add(
          item,
          2,
        );

        const reward =
          new Reward({
            currencies: [
              {
                currencyId,
                amount: 25,
              },
            ],
            items: [
              {
                itemId:
                  item.id,
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
                    item.id,
                    item,
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
        ).toBe(125);

        expect(
          inventory.getQuantity(
            item.id,
          ),
        ).toBe(5);
      },
    );

    // @invariant XINV003
    it(
      "XINV003 — autorização Interaction/Condition não altera StateStore",
      () => {
        const state =
          new StateStore();

        const key =
          createStateKey<boolean>(
            "state.has-key",
          );

        state.set(
          key,
          true,
        );

        const before =
          state.toSnapshot();

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
              key,
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
                "agent.hero",
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
            "Interaction integration deveria resolver.",
          );
        }

        expect(
          result.value.accepted,
        ).toBe(true);

        expect(
          state.toSnapshot(),
        ).toEqual(before);
      },
    );

    // @invariant XINV004
    it(
      "XINV004 — Quest projection em State e payload do Event são semanticamente idênticos",
      () => {
        const definition =
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
                requiredProgress:
                  2,
              },
            ],
          });

        const quest =
          new QuestState(
            definition,
          );

        quest.activate();

        quest.advanceGoal(
          createQuestGoalId(
            "goal.enter",
          ),
          1,
        );

        const projection =
          createQuestStateProjection(
            quest,
          );

        const state =
          new StateStore();

        const key =
          createStateKey(
            "state.quest.ruins",
          );

        const stored =
          projectQuestStateToState(
            quest,
            state,
            key,
          );

        const event =
          createQuestUpdatedEvent({
            eventId:
              createDomainEventId(
                "event.quest.ruins.1",
              ),
            sequence: 9,
            tick:
              createSimulationTick(
                77,
              ),
            quest,
            previousStatus:
              "inactive",
          });

        expect(stored).toEqual(
          projection,
        );

        expect(
          state.read(key),
        ).toEqual(
          projection,
        );

        expect(
          (
            event.payload as {
              readonly current:
                unknown;
            }
          ).current,
        ).toEqual(
          projection,
        );

        expect(
          event.metadata.source,
        ).toEqual({
          typeId: "quest",
          sourceId:
            "quest.ruins",
        });

        expect(
          event.metadata.sequence,
        ).toBe(9);

        expect(
          event.metadata.tick,
        ).toBe(77);
      },
    );

    // @invariant XINV005
    it(
      "XINV005 — Progression -> UnlockSet é monotônico e idempotente",
      () => {
        const progression =
          new LevelProgression(
            new ProgressionCurve([
              0,
              100,
              250,
              500,
            ]),
            150,
          );

        const unlocks =
          new UnlockSet();

        const unlock1 =
          createUnlockId(
            "unlock.level-1",
          );

        const unlock2 =
          createUnlockId(
            "unlock.level-2",
          );

        const unlock3 =
          createUnlockId(
            "unlock.level-3",
          );

        const plan =
          new ProgressionUnlockPlan([
            {
              level: 1,
              unlockId:
                unlock1,
            },
            {
              level: 2,
              unlockId:
                unlock2,
            },
            {
              level: 3,
              unlockId:
                unlock3,
            },
          ]);

        const first =
          applyProgressionUnlocks(
            progression,
            unlocks,
            plan,
          );

        expect(
          first.newlyUnlocked,
        ).toEqual([
          unlock1,
          unlock2,
        ]);

        const afterFirst =
          unlocks.toSnapshot();

        const second =
          applyProgressionUnlocks(
            progression,
            unlocks,
            plan,
          );

        expect(
          second.newlyUnlocked,
        ).toEqual([]);

        expect(
          second.alreadyUnlocked,
        ).toEqual([
          unlock1,
          unlock2,
        ]);

        expect(
          unlocks.toSnapshot(),
        ).toEqual(
          afterFirst,
        );

        progression.addExperience(
          150,
        );

        const third =
          applyProgressionUnlocks(
            progression,
            unlocks,
            plan,
          );

        expect(
          third.newlyUnlocked,
        ).toEqual([
          unlock3,
        ]);

        expect(
          unlocks.has(unlock1),
        ).toBe(true);

        expect(
          unlocks.has(unlock2),
        ).toBe(true);

        expect(
          unlocks.has(unlock3),
        ).toBe(true);
      },
    );

    // @invariant XINV006
    it(
      "XINV006 — DomainTime reduz StatusEffect monotonicamente e prune é explícito",
      () => {
        const effectId =
          createStatusEffectId(
            "effect.focus",
          );

        const set =
          new StatusEffectSet();

        set.apply({
          effect:
            new StatusEffect({
              id: effectId,
              name: "Focus",
              duration:
                createDomainDuration(
                  10,
                ),
            }),
          instanceId:
            createStatusEffectInstanceId(
              "effect-instance.focus",
            ),
        });

        const instance =
          set.get(effectId);

        expect(instance)
          .toBeDefined();

        if (
          instance ===
          undefined
        ) {
          throw new Error(
            "StatusEffectInstance ausente.",
          );
        }

        expect(
          instance.remaining,
        ).toBe(10);

        const first =
          advanceStatusEffectsByTime(
            set,
            createDomainDuration(
              3,
            ),
          );

        expect(first).toEqual({
          activeBefore: 1,
          activeAfter: 1,
          expiredNow: 0,
        });

        expect(
          instance.remaining,
        ).toBe(7);

        const second =
          advanceStatusEffectsByTime(
            set,
            createDomainDuration(
              7,
            ),
          );

        expect(second).toEqual({
          activeBefore: 1,
          activeAfter: 0,
          expiredNow: 1,
        });

        expect(
          instance.remaining,
        ).toBe(0);

        expect(set.size)
          .toBe(1);

        expect(
          set.pruneTerminal(),
        ).toBe(1);

        expect(set.size)
          .toBe(0);
      },
    );

    // @invariant XINV007
    it(
      "XINV007 — LocationEntered mantém identidade de source/payload/tick",
      () => {
        const current =
          createLocationRef(
            createLocationId(
              "location.forest",
            ),
          );

        const previous =
          createLocationRef(
            createLocationId(
              "location.town",
            ),
          );

        const event =
          createLocationEnteredEvent({
            eventId:
              createDomainEventId(
                "event.location.1",
              ),
            sequence: 4,
            tick:
              createSimulationTick(
                21,
              ),
            location:
              current,
            previousLocation:
              previous,
          });

        expect(
          event.typeId,
        ).toBe(
          "location.entered",
        );

        expect(
          event.metadata.source,
        ).toEqual({
          typeId: "location",
          sourceId:
            current.locationId,
        });

        expect(
          event.metadata.tick,
        ).toBe(21);

        expect(
          event.payload,
        ).toEqual({
          locationId:
            current.locationId,
          previousLocationId:
            previous.locationId,
        });
      },
    );
  },
);
