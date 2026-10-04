// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  Cost,
  CostError,
  CraftingRecipe,
  CraftingRecipeError,
  createCraftingRecipeId,
  createCurrencyId,
  createItemId,
  createLootEntryId,
  createLootTableId,
  CurrencyAccount,
  CurrencyAccountError,
  LootEntry,
  LootTable,
  LootTableError,
  Reward,
  RewardError,
  RewardPolicy,
} from "../src/domain/economy";

class SequenceRandom {
  private index =
    0;

  public constructor(
    private readonly values:
      readonly number[],
  ) {}

  public nextFloat():
    number {
    const value =
      this.values[
        this.index
      ];

    if (
      value === undefined
    ) {
      throw new Error(
        "SequenceRandom esgotado.",
      );
    }

    this.index += 1;

    return value;
  }
}

describe(
  "Etapa 56 — CurrencyAccount",
  () => {
    it(
      "credita e debita mantendo saldo não negativo",
      () => {
        const gold =
          createCurrencyId(
            "currency.gold",
          );

        const account =
          new CurrencyAccount({
            currencyId: gold,
            balance: 10,
          });

        expect(
          account.credit(5),
        ).toBe(15);

        expect(
          account.tryDebit(7),
        ).toBe(true);

        expect(
          account.balance,
        ).toBe(8);

        expect(
          account.tryDebit(9),
        ).toBe(false);

        expect(
          account.balance,
        ).toBe(8);
      },
    );

    it(
      "transferência valida tudo antes de mutar",
      () => {
        const gold =
          createCurrencyId(
            "currency.gold",
          );

        const source =
          new CurrencyAccount({
            currencyId: gold,
            balance: 30,
          });

        const target =
          new CurrencyAccount({
            currencyId: gold,
            balance: 5,
          });

        expect(
          source.tryTransferTo(
            target,
            20,
          ),
        ).toBe(true);

        expect(source.balance).toBe(
          10,
        );

        expect(target.balance).toBe(
          25,
        );

        expect(
          source.tryTransferTo(
            target,
            11,
          ),
        ).toBe(false);

        expect(source.balance).toBe(
          10,
        );

        expect(target.balance).toBe(
          25,
        );
      },
    );

    it(
      "rejeita transferência entre moedas diferentes",
      () => {
        const gold =
          new CurrencyAccount({
            currencyId:
              createCurrencyId(
                "currency.gold",
              ),
          });

        const gems =
          new CurrencyAccount({
            currencyId:
              createCurrencyId(
                "currency.gems",
              ),
          });

        expect(() =>
          gold.tryTransferTo(
            gems,
            1,
          ),
        ).toThrow(
          CurrencyAccountError,
        );
      },
    );

    it(
      "snapshot round-trip preserva saldo",
      () => {
        const account =
          new CurrencyAccount({
            currencyId:
              createCurrencyId(
                "currency.credits",
              ),
            balance: 900,
          });

        const snapshot =
          account.toSnapshot();

        expect(
          CurrencyAccount
            .fromSnapshot(
              snapshot,
            )
            .toSnapshot(),
        ).toEqual(snapshot);
      },
    );
  },
);

describe(
  "Etapa 56 — Cost",
  () => {
    it(
      "normaliza entradas em ordem determinística",
      () => {
        const cost =
          new Cost([
            {
              currencyId:
                createCurrencyId(
                  "currency.zeta",
                ),
              amount: 2,
            },
            {
              currencyId:
                createCurrencyId(
                  "currency.alpha",
                ),
              amount: 5,
            },
          ]);

        expect(
          cost
            .getEntries()
            .map(
              (entry) =>
                entry.currencyId,
            ),
        ).toEqual([
          "currency.alpha",
          "currency.zeta",
        ]);
      },
    );

    it(
      "pagamento multi-moeda é atômico quando uma conta não cobre o custo",
      () => {
        const goldId =
          createCurrencyId(
            "currency.gold",
          );

        const gemsId =
          createCurrencyId(
            "currency.gems",
          );

        const gold =
          new CurrencyAccount({
            currencyId:
              goldId,
            balance: 100,
          });

        const gems =
          new CurrencyAccount({
            currencyId:
              gemsId,
            balance: 1,
          });

        const cost =
          new Cost([
            {
              currencyId:
                goldId,
              amount: 50,
            },
            {
              currencyId:
                gemsId,
              amount: 2,
            },
          ]);

        expect(
          cost.tryPay([
            gold,
            gems,
          ]),
        ).toBe(false);

        expect(gold.balance).toBe(
          100,
        );

        expect(gems.balance).toBe(
          1,
        );
      },
    );

    it(
      "pagamento multi-moeda debita todas as contas quando coberto",
      () => {
        const goldId =
          createCurrencyId(
            "currency.gold",
          );

        const gemsId =
          createCurrencyId(
            "currency.gems",
          );

        const gold =
          new CurrencyAccount({
            currencyId:
              goldId,
            balance: 100,
          });

        const gems =
          new CurrencyAccount({
            currencyId:
              gemsId,
            balance: 10,
          });

        const cost =
          new Cost([
            {
              currencyId:
                goldId,
              amount: 50,
            },
            {
              currencyId:
                gemsId,
              amount: 2,
            },
          ]);

        expect(
          cost.tryPay([
            gold,
            gems,
          ]),
        ).toBe(true);

        expect(gold.balance).toBe(
          50,
        );

        expect(gems.balance).toBe(
          8,
        );
      },
    );

    it(
      "rejeita moeda duplicada e contas ambíguas",
      () => {
        const goldId =
          createCurrencyId(
            "currency.gold",
          );

        expect(() =>
          new Cost([
            {
              currencyId:
                goldId,
              amount: 1,
            },
            {
              currencyId:
                goldId,
              amount: 2,
            },
          ]),
        ).toThrow(
          CostError,
        );

        const cost =
          new Cost([
            {
              currencyId:
                goldId,
              amount: 1,
            },
          ]);

        const accountA =
          new CurrencyAccount({
            currencyId:
              goldId,
            balance: 10,
          });

        const accountB =
          new CurrencyAccount({
            currencyId:
              goldId,
            balance: 10,
          });

        expect(() =>
          cost.canAfford([
            accountA,
            accountB,
          ]),
        ).toThrow(
          CostError,
        );
      },
    );
  },
);

describe(
  "Etapa 56 — Reward",
  () => {
    it(
      "mantém grants declarativos ordenados",
      () => {
        const reward =
          new Reward({
            currencies: [
              {
                currencyId:
                  createCurrencyId(
                    "currency.z",
                  ),
                amount: 2,
              },
              {
                currencyId:
                  createCurrencyId(
                    "currency.a",
                  ),
                amount: 1,
              },
            ],
            items: [
              {
                itemId:
                  createItemId(
                    "item.z",
                  ),
                quantity: 4,
              },
              {
                itemId:
                  createItemId(
                    "item.a",
                  ),
                quantity: 2,
              },
            ],
          });

        expect(
          reward
            .getCurrencyEntries()
            .map(
              (entry) =>
                entry.currencyId,
            ),
        ).toEqual([
          "currency.a",
          "currency.z",
        ]);

        expect(
          reward
            .getItemEntries()
            .map(
              (entry) =>
                entry.itemId,
            ),
        ).toEqual([
          "item.a",
          "item.z",
        ]);
      },
    );

    it(
      "rejeita reward vazio/duplicado",
      () => {
        expect(() =>
          new Reward(),
        ).toThrow(
          RewardError,
        );

        const gold =
          createCurrencyId(
            "currency.gold",
          );

        expect(() =>
          new Reward({
            currencies: [
              {
                currencyId:
                  gold,
                amount: 1,
              },
              {
                currencyId:
                  gold,
                amount: 2,
              },
            ],
          }),
        ).toThrow(
          RewardError,
        );
      },
    );
  },
);

describe(
  "Etapa 56 — LootTable / RewardPolicy",
  () => {
    function makeTable() {
      const common =
        new LootEntry({
          id:
            createLootEntryId(
              "loot.common",
            ),
          weight: 75,
          reward:
            new Reward({
              currencies: [
                {
                  currencyId:
                    createCurrencyId(
                      "currency.gold",
                    ),
                  amount: 1,
                },
              ],
            }),
        });

      const rare =
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
        });

      return new LootTable(
        createLootTableId(
          "loot-table.chest",
        ),
        [
          rare,
          common,
        ],
      );
    }

    it(
      "usa ordem canônica e RNG injetado",
      () => {
        const table =
          makeTable();

        const results =
          table.roll(
            new SequenceRandom([
              0.00,
              0.74,
              0.75,
              0.99,
            ]),
            new RewardPolicy({
              rolls: 4,
            }),
          );

        expect(
          results.map(
            (result) =>
              result.entryId,
          ),
        ).toEqual([
          "loot.common",
          "loot.common",
          "loot.rare",
          "loot.rare",
        ]);
      },
    );

    it(
      "sem reposição não repete entrada",
      () => {
        const table =
          makeTable();

        const results =
          table.roll(
            new SequenceRandom([
              0.90,
              0.50,
            ]),
            new RewardPolicy({
              rolls: 2,
              replacement:
                "without-replacement",
            }),
          );

        expect(
          new Set(
            results.map(
              (result) =>
                result.entryId,
            ),
          ).size,
        ).toBe(2);
      },
    );

    it(
      "sem reposição rejeita rolls além do número de entradas",
      () => {
        const table =
          makeTable();

        expect(() =>
          table.roll(
            new SequenceRandom([
              0,
            ]),
            new RewardPolicy({
              rolls: 3,
              replacement:
                "without-replacement",
            }),
          ),
        ).toThrow(
          LootTableError,
        );
      },
    );

    it(
      "rejeita valor aleatório fora do contrato",
      () => {
        const table =
          makeTable();

        expect(() =>
          table.roll(
            new SequenceRandom([
              1,
            ]),
          ),
        ).toThrow(
          LootTableError,
        );
      },
    );

    it(
      "snapshot round-trip preserva tabela",
      () => {
        const table =
          makeTable();

        const snapshot =
          table.toSnapshot();

        expect(
          LootTable
            .fromSnapshot(
              snapshot,
            )
            .toSnapshot(),
        ).toEqual(snapshot);
      },
    );
  },
);

describe(
  "Etapa 56 — CraftingRecipe",
  () => {
    it(
      "ordena ingredientes e preserva cost/reward declarativos",
      () => {
        const recipe =
          new CraftingRecipe({
            id:
              createCraftingRecipeId(
                "recipe.sword",
              ),
            ingredients: [
              {
                itemId:
                  createItemId(
                    "item.wood",
                  ),
                quantity: 1,
              },
              {
                itemId:
                  createItemId(
                    "item.iron",
                  ),
                quantity: 3,
              },
            ],
            cost:
              new Cost([
                {
                  currencyId:
                    createCurrencyId(
                      "currency.gold",
                    ),
                  amount: 25,
                },
              ]),
            reward:
              new Reward({
                items: [
                  {
                    itemId:
                      createItemId(
                        "item.sword",
                      ),
                    quantity: 1,
                  },
                ],
              }),
          });

        expect(
          recipe
            .getIngredients()
            .map(
              (ingredient) =>
                ingredient.itemId,
            ),
        ).toEqual([
          "item.iron",
          "item.wood",
        ]);

        expect(
          recipe.cost?.size,
        ).toBe(1);

        expect(
          recipe.reward.itemCount,
        ).toBe(1);
      },
    );

    it(
      "permite recipe só com Cost, mas rejeita ausência total de requisitos",
      () => {
        const reward =
          new Reward({
            items: [
              {
                itemId:
                  createItemId(
                    "item.service",
                  ),
                quantity: 1,
              },
            ],
          });

        expect(() =>
          new CraftingRecipe({
            id:
              createCraftingRecipeId(
                "recipe.invalid",
              ),
            reward,
          }),
        ).toThrow(
          CraftingRecipeError,
        );

        const recipe =
          new CraftingRecipe({
            id:
              createCraftingRecipeId(
                "recipe.currency-only",
              ),
            cost:
              new Cost([
                {
                  currencyId:
                    createCurrencyId(
                      "currency.gold",
                    ),
                  amount: 10,
                },
              ]),
            reward,
          });

        expect(
          recipe.ingredientCount,
        ).toBe(0);
      },
    );

    it(
      "rejeita ingrediente duplicado",
      () => {
        const itemId =
          createItemId(
            "item.iron",
          );

        expect(() =>
          new CraftingRecipe({
            id:
              createCraftingRecipeId(
                "recipe.duplicate",
              ),
            ingredients: [
              {
                itemId,
                quantity: 1,
              },
              {
                itemId,
                quantity: 2,
              },
            ],
            reward:
              new Reward({
                items: [
                  {
                    itemId:
                      createItemId(
                        "item.output",
                      ),
                    quantity: 1,
                  },
                ],
              }),
          }),
        ).toThrow(
          CraftingRecipeError,
        );
      },
    );

    it(
      "snapshot round-trip preserva recipe",
      () => {
        const recipe =
          new CraftingRecipe({
            id:
              createCraftingRecipeId(
                "recipe.roundtrip",
              ),
            ingredients: [
              {
                itemId:
                  createItemId(
                    "item.input",
                  ),
                quantity: 2,
              },
            ],
            reward:
              new Reward({
                currencies: [
                  {
                    currencyId:
                      createCurrencyId(
                        "currency.token",
                      ),
                    amount: 5,
                  },
                ],
              }),
          });

        const snapshot =
          recipe.toSnapshot();

        expect(
          CraftingRecipe
            .fromSnapshot(
              snapshot,
            )
            .toSnapshot(),
        ).toEqual(snapshot);
      },
    );
  },
);
