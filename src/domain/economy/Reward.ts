import {
  createItemId,
} from "./Item";

import type {
  ItemId,
} from "./Item";

import {
  createCurrencyId,
} from "./CurrencyId";

import type {
  CurrencyId,
} from "./CurrencyId";

export interface RewardCurrencyEntry {
  readonly currencyId:
    CurrencyId;
  readonly amount:
    number;
}

export interface RewardItemEntry {
  readonly itemId:
    ItemId;
  readonly quantity:
    number;
}

export interface RewardCreateOptions {
  readonly currencies?:
    readonly RewardCurrencyEntry[];
  readonly items?:
    readonly RewardItemEntry[];
}

export interface RewardSnapshot {
  readonly currencies:
    readonly {
      readonly currencyId:
        string;
      readonly amount:
        number;
    }[];
  readonly items:
    readonly {
      readonly itemId:
        string;
      readonly quantity:
        number;
    }[];
}

export type RewardErrorCode =
  | "empty-reward"
  | "invalid-amount"
  | "invalid-quantity"
  | "duplicate-currency"
  | "duplicate-item"
  | "invalid-snapshot";

export class RewardError
  extends Error {
  public readonly name =
    "RewardError";

  public constructor(
    public readonly code:
      RewardErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function compareId(
  left: string,
  right: string,
): number {
  return left < right
    ? -1
    : left > right
      ? 1
      : 0;
}

function assertPositiveInteger(
  value: number,
  label: string,
  code:
    | "invalid-amount"
    | "invalid-quantity",
): void {
  if (
    !Number.isSafeInteger(
      value,
    ) ||
    value < 1
  ) {
    throw new RewardError(
      code,
      `${label} deve ser inteiro seguro maior ou igual a 1.`,
    );
  }
}

/**
 * Descrição imutável de recompensa.
 *
 * Contém grants econômicos, mas não os aplica automaticamente a containers
 * runtime. A execução/orquestração fica para a integração cross-domain.
 */
export class Reward {
  private readonly currencies:
    readonly RewardCurrencyEntry[];

  private readonly items:
    readonly RewardItemEntry[];

  public constructor(
    options:
      RewardCreateOptions = {},
  ) {
    const currencySource =
      options.currencies ?? [];

    const itemSource =
      options.items ?? [];

    if (
      currencySource.length ===
        0 &&
      itemSource.length === 0
    ) {
      throw new RewardError(
        "empty-reward",
        "Reward exige ao menos uma entrada de moeda ou item.",
      );
    }

    const currencyIds =
      new Set<CurrencyId>();

    const currencyCopy:
      RewardCurrencyEntry[] =
        [];

    for (
      const entry of
      currencySource
    ) {
      assertPositiveInteger(
        entry.amount,
        "Reward currency amount",
        "invalid-amount",
      );

      if (
        currencyIds.has(
          entry.currencyId,
        )
      ) {
        throw new RewardError(
          "duplicate-currency",
          `CurrencyId duplicada em Reward: "${entry.currencyId}".`,
        );
      }

      currencyIds.add(
        entry.currencyId,
      );

      currencyCopy.push(
        Object.freeze({
          currencyId:
            entry.currencyId,
          amount:
            entry.amount,
        }),
      );
    }

    const itemIds =
      new Set<ItemId>();

    const itemCopy:
      RewardItemEntry[] =
        [];

    for (
      const entry of
      itemSource
    ) {
      assertPositiveInteger(
        entry.quantity,
        "Reward item quantity",
        "invalid-quantity",
      );

      if (
        itemIds.has(
          entry.itemId,
        )
      ) {
        throw new RewardError(
          "duplicate-item",
          `ItemId duplicado em Reward: "${entry.itemId}".`,
        );
      }

      itemIds.add(
        entry.itemId,
      );

      itemCopy.push(
        Object.freeze({
          itemId:
            entry.itemId,
          quantity:
            entry.quantity,
        }),
      );
    }

    currencyCopy.sort(
      (left, right) =>
        compareId(
          left.currencyId,
          right.currencyId,
        ),
    );

    itemCopy.sort(
      (left, right) =>
        compareId(
          left.itemId,
          right.itemId,
        ),
    );

    this.currencies =
      Object.freeze(
        currencyCopy,
      );

    this.items =
      Object.freeze(
        itemCopy,
      );
  }

  public static fromSnapshot(
    snapshot:
      RewardSnapshot,
  ): Reward {
    try {
      return new Reward({
        currencies:
          snapshot.currencies.map(
            (entry) => ({
              currencyId:
                createCurrencyId(
                  entry.currencyId,
                ),
              amount:
                entry.amount,
            }),
          ),
        items:
          snapshot.items.map(
            (entry) => ({
              itemId:
                createItemId(
                  entry.itemId,
                ),
              quantity:
                entry.quantity,
            }),
          ),
      });
    } catch (error) {
      throw new RewardError(
        "invalid-snapshot",
        `RewardSnapshot inválido: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );
    }
  }

  public get currencyCount():
    number {
    return this.currencies.length;
  }

  public get itemCount():
    number {
    return this.items.length;
  }

  public getCurrencyEntries():
    readonly RewardCurrencyEntry[] {
    return this.currencies;
  }

  public getItemEntries():
    readonly RewardItemEntry[] {
    return this.items;
  }

  public toSnapshot():
    RewardSnapshot {
    return Object.freeze({
      currencies:
        Object.freeze(
          this.currencies.map(
            (entry) =>
              Object.freeze({
                currencyId:
                  entry.currencyId,
                amount:
                  entry.amount,
              }),
          ),
        ),
      items:
        Object.freeze(
          this.items.map(
            (entry) =>
              Object.freeze({
                itemId:
                  entry.itemId,
                quantity:
                  entry.quantity,
              }),
          ),
        ),
    });
  }
}
