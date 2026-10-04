// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createItemId,
  Inventory,
  InventoryError,
  Item,
} from "../src/domain/economy";

function createPotion():
  Item {
  return new Item({
    id: createItemId(
      "item.potion",
    ),
    name: "Potion",
    description:
      "Restores health.",
    maxStack: 20,
  });
}

describe(
  "Etapa 44.2 — Inventory",
  () => {
    it(
      "usa quantidade agregada e calcula slots através de maxStack",
      () => {
        const inventory =
          new Inventory({
            maxSlots: 3,
          });

        const potion =
          createPotion();

        expect(
          inventory.add(
            potion,
            20,
          ),
        ).toBe(20);

        expect(
          inventory.occupiedSlots,
        ).toBe(1);

        expect(
          inventory.add(
            potion,
            1,
          ),
        ).toBe(21);

        expect(
          inventory.occupiedSlots,
        ).toBe(2);

        expect(
          inventory.totalUnits,
        ).toBe(21);

        expect(
          inventory.uniqueItemCount,
        ).toBe(1);
      },
    );

    it(
      "falha atomicamente ao exceder capacidade",
      () => {
        const inventory =
          new Inventory({
            maxSlots: 2,
          });

        const potion =
          createPotion();

        inventory.add(
          potion,
          40,
        );

        expect(
          inventory.canAdd(
            potion,
            1,
          ),
        ).toBe(false);

        expect(() =>
          inventory.add(
            potion,
            1,
          ),
        ).toThrow(
          InventoryError,
        );

        expect(
          inventory.getQuantity(
            potion.id,
          ),
        ).toBe(40);

        expect(
          inventory.occupiedSlots,
        ).toBe(2);

        expect(
          inventory.totalUnits,
        ).toBe(40);
      },
    );

    it(
      "libera slots incrementalmente ao remover",
      () => {
        const inventory =
          new Inventory({
            maxSlots: 3,
          });

        const potion =
          createPotion();

        inventory.add(
          potion,
          41,
        );

        expect(
          inventory.occupiedSlots,
        ).toBe(3);

        expect(
          inventory.remove(
            potion.id,
            2,
          ),
        ).toBe(39);

        expect(
          inventory.occupiedSlots,
        ).toBe(2);

        expect(
          inventory.totalUnits,
        ).toBe(39);

        expect(
          inventory.remove(
            potion.id,
            100,
          ),
        ).toBe(0);

        expect(
          inventory.isEmpty,
        ).toBe(true);

        expect(
          inventory.occupiedSlots,
        ).toBe(0);

        expect(
          inventory.totalUnits,
        ).toBe(0);
      },
    );

    it(
      "mantém múltiplos ItemIds com lookup direto",
      () => {
        const inventory =
          new Inventory();

        const potion =
          createPotion();

        const key =
          new Item({
            id: createItemId(
              "item.key",
            ),
            name: "Key",
            maxStack: 1,
          });

        inventory.add(
          potion,
          5,
        );

        inventory.add(
          key,
          1,
        );

        expect(
          inventory.has(
            potion.id,
            5,
          ),
        ).toBe(true);

        expect(
          inventory.has(
            potion.id,
            6,
          ),
        ).toBe(false);

        expect(
          inventory.getQuantity(
            key.id,
          ),
        ).toBe(1);

        expect(
          inventory.getItem(
            key.id,
          ),
        ).toBe(key);

        expect(
          inventory.uniqueItemCount,
        ).toBe(2);
      },
    );

    it(
      "rejeita definição conflitante para o mesmo ItemId",
      () => {
        const inventory =
          new Inventory();

        const first =
          createPotion();

        const conflicting =
          new Item({
            id: first.id,
            name:
              "Different Potion",
            description:
              first.description,
            maxStack:
              first.maxStack,
          });

        inventory.add(
          first,
          1,
        );

        expect(
          inventory.canAdd(
            conflicting,
            1,
          ),
        ).toBe(false);

        try {
          inventory.add(
            conflicting,
            1,
          );

          throw new Error(
            "add deveria falhar.",
          );
        } catch (error) {
          expect(error).toBeInstanceOf(
            InventoryError,
          );

          if (
            error instanceof
            InventoryError
          ) {
            expect(
              error.code,
            ).toBe(
              "item-definition-conflict",
            );
          }
        }

        expect(
          inventory.getQuantity(
            first.id,
          ),
        ).toBe(1);
      },
    );

    it(
      "produz snapshot determinístico ordenado por ItemId",
      () => {
        const inventory =
          new Inventory({
            maxSlots: 5,
          });

        const zeta =
          new Item({
            id: createItemId(
              "item.zeta",
            ),
            name: "Zeta",
            maxStack: 10,
          });

        const alpha =
          new Item({
            id: createItemId(
              "item.alpha",
            ),
            name: "Alpha",
            maxStack: 5,
          });

        inventory.add(
          zeta,
          3,
        );

        inventory.add(
          alpha,
          6,
        );

        expect(
          inventory.toSnapshot(),
        ).toEqual({
          maxSlots: 5,
          occupiedSlots: 3,
          totalUnits: 9,
          entries: [
            {
              itemId:
                "item.alpha",
              quantity: 6,
            },
            {
              itemId:
                "item.zeta",
              quantity: 3,
            },
          ],
        });
      },
    );

    it(
      "forEach percorre o estado sem exigir snapshot",
      () => {
        const inventory =
          new Inventory();

        const potion =
          createPotion();

        inventory.add(
          potion,
          7,
        );

        let observedItem:
          Item | null = null;

        let observedQuantity =
          0;

        inventory.forEach(
          (item, quantity) => {
            observedItem = item;
            observedQuantity =
              quantity;
          },
        );

        expect(
          observedItem,
        ).toBe(potion);

        expect(
          observedQuantity,
        ).toBe(7);
      },
    );

    it(
      "rejeita capacidade e quantidades inválidas",
      () => {
        expect(() =>
          new Inventory({
            maxSlots: 0,
          }),
        ).toThrow(
          InventoryError,
        );

        const inventory =
          new Inventory();

        const potion =
          createPotion();

        expect(() =>
          inventory.add(
            potion,
            0,
          ),
        ).toThrow(
          InventoryError,
        );

        expect(() =>
          inventory.remove(
            potion.id,
            1.5,
          ),
        ).toThrow(
          InventoryError,
        );

        expect(() =>
          inventory.has(
            potion.id,
            0,
          ),
        ).toThrow(
          InventoryError,
        );
      },
    );
  },
);
