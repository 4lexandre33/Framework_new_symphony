// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createItemId,
  Inventory,
  Item,
} from "../src/domain/economy";

import {
  Cooldown,
  CooldownSet,
  createCooldownId,
  createModifierId,
  createModifierOperation,
  createModifierTargetId,
  createStatusEffectId,
  createStatusEffectInstanceId,
  Modifier,
  ModifierSet,
  StatusEffect,
  StatusEffectSet,
} from "../src/domain/mechanics";

import {
  createStateKey,
  StateStore,
} from "../src/domain/state";

import {
  createDomainTag,
  TagSet,
} from "../src/domain/tags";

import {
  createDomainDuration,
} from "../src/domain/time";

describe(
  "Etapa 67 — Lifecycle e retenção lógica",
  () => {
    it(
      "StateStore read reutiliza a referência readonly armazenada",
      () => {
        const store =
          new StateStore();

        const key =
          createStateKey(
            "state.performance-object",
          );

        store.set(
          key,
          {
            nested: {
              value: 42,
            },
          },
        );

        const first =
          store.read(key);

        const second =
          store.read(key);

        expect(first).toBe(
          second,
        );

        expect(
          Object.isFrozen(
            first as object,
          ),
        ).toBe(true);

        expect(
          store.delete(key),
        ).toBe(true);

        expect(store.size)
          .toBe(0);
      },
    );

    it(
      "ModifierSet reutiliza bucket readonly até ocorrer mutação",
      () => {
        const set =
          new ModifierSet();

        const targetId =
          createModifierTargetId(
            "attribute.damage",
          );

        set.add(
          new Modifier({
            id:
              createModifierId(
                "modifier.a",
              ),
            targetId,
            operation:
              createModifierOperation(
                "add",
                1,
              ),
          }),
        );

        const first =
          set.getModifiersForTarget(
            targetId,
          );

        const second =
          set.getModifiersForTarget(
            targetId,
          );

        expect(first).toBe(
          second,
        );

        set.add(
          new Modifier({
            id:
              createModifierId(
                "modifier.b",
              ),
            targetId,
            operation:
              createModifierOperation(
                "multiply",
                2,
              ),
          }),
        );

        const afterMutation =
          set.getModifiersForTarget(
            targetId,
          );

        expect(
          afterMutation,
        ).not.toBe(first);

        expect(
          set.evaluate(
            targetId,
            10,
          ),
        ).toBe(22);

        set.clear();

        expect(set.size)
          .toBe(0);
      },
    );

    it(
      "StatusEffect terminal permanece observável até prune e então é liberado",
      () => {
        const set =
          new StatusEffectSet();

        const count = 500;

        for (
          let index = 0;
          index < count;
          index += 1
        ) {
          const suffix =
            String(index);

          set.apply({
            effect:
              new StatusEffect({
                id:
                  createStatusEffectId(
                    `effect.stage67.${suffix}`,
                  ),
                name:
                  `Effect ${suffix}`,
                duration:
                  createDomainDuration(
                    5,
                  ),
              }),
            instanceId:
              createStatusEffectInstanceId(
                `effect-instance.stage67.${suffix}`,
              ),
          });
        }

        expect(set.size)
          .toBe(count);

        set.advance(
          createDomainDuration(
            5,
          ),
        );

        expect(
          set.activeCount,
        ).toBe(0);

        expect(set.size)
          .toBe(count);

        expect(
          set.pruneTerminal(),
        ).toBe(count);

        expect(set.size)
          .toBe(0);
      },
    );

    it(
      "CooldownSet completa sem criar novos registros e clear libera coleção",
      () => {
        const set =
          new CooldownSet();

        const count = 500;

        for (
          let index = 0;
          index < count;
          index += 1
        ) {
          set.add(
            new Cooldown({
              id:
                createCooldownId(
                  `cooldown.stage67.${String(index)}`,
                ),
              duration:
                createDomainDuration(
                  10,
                ),
              startActive:
                true,
            }),
          );
        }

        expect(set.size)
          .toBe(count);

        set.advance(
          createDomainDuration(
            10,
          ),
        );

        expect(
          set.activeCount,
        ).toBe(0);

        expect(set.size)
          .toBe(count);

        set.clear();

        expect(set.size)
          .toBe(0);
      },
    );

    it(
      "Inventory e TagSet oferecem release explícito de referências",
      () => {
        const inventory =
          new Inventory();

        const item =
          new Item({
            id:
              createItemId(
                "item.stage67",
              ),
            name:
              "Stage 67 Item",
            maxStack: 100,
          });

        inventory.add(
          item,
          75,
        );

        expect(
          inventory.getItem(
            item.id,
          ),
        ).toBe(item);

        inventory.clear();

        expect(
          inventory.getItem(
            item.id,
          ),
        ).toBeNull();

        expect(
          inventory.totalUnits,
        ).toBe(0);

        expect(
          inventory.occupiedSlots,
        ).toBe(0);

        const tags =
          new TagSet([
            createDomainTag(
              "stage67.performance",
            ),
          ]);

        expect(tags.size)
          .toBe(1);

        tags.clear();

        expect(tags.size)
          .toBe(0);
      },
    );
  },
);
