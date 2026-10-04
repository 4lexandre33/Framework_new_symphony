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
  CurrencyAccount,
  createCurrencyId,
  createItemId,
  Inventory,
  Item,
  Reward,
} from "../src/domain/economy";

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
  "Etapa 62 — cenário headless cross-domain",
  () => {
    it(
      "executa jornada lógica completa sem apresentação/plataforma",
      () => {
        const state =
          new StateStore();

        const locationEvent =
          createLocationEnteredEvent({
            eventId:
              createDomainEventId(
                "event.location.headless",
              ),
            sequence: 1,
            tick:
              createSimulationTick(
                10,
              ),
            location:
              createLocationRef(
                createLocationId(
                  "location.ruins",
                ),
              ),
          });

        expect(
          locationEvent.payload,
        ).toMatchObject({
          locationId:
            "location.ruins",
        });

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

        const interactionId =
          createInteractionId(
            "interaction.open",
          );

        const target =
          createInteractionTargetRef(
            createInteractionTargetTypeId(
              "target.chest",
            ),
            createInteractionTargetId(
              "chest.ancient",
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

        const interaction =
          resolveInteractionWithConditions(
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
            ),
            affordance,
            [
              {
                requirementId,
                condition:
                  createConditionDefinition(
                    createConditionId(
                      "condition.has-key",
                    ),
                    createStateCompareCondition(
                      hasKey,
                      "equals",
                      true,
                    ),
                  ),
              },
            ],
            state,
          );

        expect(
          interaction.ok,
        ).toBe(true);

        if (
          !interaction.ok ||
          !interaction.value
            .accepted
        ) {
          throw new Error(
            "Chest deveria estar autorizado.",
          );
        }

        const coins =
          createCurrencyId(
            "currency.coins",
          );

        const account =
          new CurrencyAccount({
            currencyId: coins,
          });

        const relic =
          new Item({
            id:
              createItemId(
                "item.relic",
              ),
            name: "Relic",
            maxStack: 1,
          });

        const inventory =
          new Inventory({
            maxSlots: 4,
          });

        const grant =
          grantRewardAtomically(
            new Reward({
              currencies: [
                {
                  currencyId:
                    coins,
                  amount: 50,
                },
              ],
              items: [
                {
                  itemId:
                    relic.id,
                  quantity: 1,
                },
              ],
            }),
            {
              inventory,
              currencyAccounts: [
                account,
              ],
              itemDefinitions:
                new Map([
                  [
                    relic.id,
                    relic,
                  ],
                ]),
            },
          );

        expect(
          grant.granted,
        ).toBe(true);

        const progression =
          new LevelProgression(
            new ProgressionCurve([
              0,
              100,
              300,
            ]),
          );

        progression.addExperience(
          120,
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
                  "unlock.ruins-route",
                ),
            },
          ]),
        );

        expect(
          unlocks.has(
            createUnlockId(
              "unlock.ruins-route",
            ),
          ),
        ).toBe(true);

        const quest =
          new QuestState(
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
                      "goal.find-relic",
                    ),
                  kindId:
                    createQuestGoalKindId(
                      "goal-kind.collect",
                    ),
                },
              ],
            }),
          );

        quest.activate();
        quest.completeGoal(
          createQuestGoalId(
            "goal.find-relic",
          ),
        );

        const questKey =
          createStateKey(
            "state.quest.ruins",
          );

        projectQuestStateToState(
          quest,
          state,
          questKey,
        );

        expect(
          state.read(
            questKey,
          ),
        ).toMatchObject({
          status: "completed",
        });

        const questEvent =
          createQuestUpdatedEvent({
            eventId:
              createDomainEventId(
                "event.quest.headless",
              ),
            sequence: 2,
            tick:
              createSimulationTick(
                11,
              ),
            quest,
            previousStatus:
              "active",
          });

        expect(
          questEvent.payload,
        ).toMatchObject({
          previousStatus:
            "active",
        });

        const effects =
          new StatusEffectSet();

        effects.apply({
          effect:
            new StatusEffect({
              id:
                createStatusEffectId(
                  "effect.focus",
                ),
              name: "Focus",
              duration:
                createDomainDuration(
                  5,
                ),
            }),
          instanceId:
            createStatusEffectInstanceId(
              "effect-instance.focus",
            ),
        });

        const timeResult =
          advanceStatusEffectsByTime(
            effects,
            createDomainDuration(
              5,
            ),
          );

        expect(
          timeResult,
        ).toEqual({
          activeBefore: 1,
          activeAfter: 0,
          expiredNow: 1,
        });

        expect(
          account.balance,
        ).toBe(50);

        expect(
          inventory.getQuantity(
            relic.id,
          ),
        ).toBe(1);
      },
    );
  },
);
