// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createItemId,
  Item,
  ItemInvariantError,
} from "../src/domain/economy";

describe(
  "Etapa 44.1 — Item",
  () => {
    it(
      "cria definição imutável não stackable",
      () => {
        const item =
          new Item({
            id: createItemId(
              "item.key",
            ),
            name: "Key",
            description:
              "Opens a locked door.",
            maxStack: 1,
          });

        expect(item.id).toBe(
          "item.key",
        );
        expect(item.stackable).toBe(
          false,
        );
        expect(
          item.canStackQuantity(1),
        ).toBe(true);
        expect(
          item.canStackQuantity(2),
        ).toBe(false);
      },
    );

    it(
      "deriva stackability apenas de maxStack",
      () => {
        const item =
          new Item({
            id: createItemId(
              "item.potion",
            ),
            name: "Potion",
            maxStack: 20,
          });

        expect(item.stackable).toBe(
          true,
        );
        expect(
          item.canStackQuantity(20),
        ).toBe(true);
        expect(
          item.canStackQuantity(21),
        ).toBe(false);
      },
    );

    it(
      "normaliza ausência de description para null sem inventar asset",
      () => {
        const item =
          new Item({
            id: createItemId(
              "item.ore",
            ),
            name: "Ore",
            maxStack: 99,
          });

        const snapshot =
          item.toSnapshot();

        expect(snapshot).toEqual({
          id: "item.ore",
          name: "Ore",
          description: null,
          maxStack: 99,
        });

        expect(
          Object.keys(snapshot),
        ).not.toEqual(
          expect.arrayContaining([
            "texture",
            "sprite",
            "mesh",
            "model",
            "material",
            "position",
            "collider",
          ]),
        );
      },
    );

    it(
      "rejeita nome e stack inválidos",
      () => {
        const id =
          createItemId(
            "item.invalid",
          );

        expect(() =>
          new Item({
            id,
            name: "",
            maxStack: 1,
          }),
        ).toThrow(
          ItemInvariantError,
        );

        expect(() =>
          new Item({
            id,
            name: "Invalid",
            maxStack: 0,
          }),
        ).toThrow(
          ItemInvariantError,
        );

        expect(() =>
          new Item({
            id,
            name: "Invalid",
            maxStack: 1.5,
          }),
        ).toThrow(
          ItemInvariantError,
        );
      },
    );
  },
);
