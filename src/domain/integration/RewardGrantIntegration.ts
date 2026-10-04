import type {
  CurrencyAccount,
  CurrencyId,
  Inventory,
  Item,
  ItemId,
  Reward,
} from "../economy";

export interface RewardGrantContext {
  readonly inventory:
    Inventory;
  readonly currencyAccounts:
    readonly CurrencyAccount[];
  readonly itemDefinitions:
    ReadonlyMap<ItemId, Item>;
}

export type RewardGrantRejectionReason =
  | "missing-currency-account"
  | "currency-overflow"
  | "missing-item-definition"
  | "item-definition-conflict"
  | "inventory-capacity"
  | "quantity-overflow";

export interface RewardGrantRejected {
  readonly granted:
    false;
  readonly reason:
    RewardGrantRejectionReason;
  readonly id:
    string;
}

export interface RewardGrantAccepted {
  readonly granted:
    true;
  readonly currencyEntries:
    number;
  readonly itemEntries:
    number;
  readonly totalCurrencyUnits:
    number;
  readonly totalItemUnits:
    number;
}

export type RewardGrantResult =
  | RewardGrantRejected
  | RewardGrantAccepted;

export type RewardGrantIntegrationErrorCode =
  | "duplicate-currency-account"
  | "item-map-mismatch";

export class RewardGrantIntegrationError
  extends Error {
  public readonly name =
    "RewardGrantIntegrationError";

  public constructor(
    public readonly code:
      RewardGrantIntegrationErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function sameItemDefinition(
  left: Item,
  right: Item,
): boolean {
  return (
    left.id === right.id &&
    left.name === right.name &&
    left.description ===
      right.description &&
    left.maxStack ===
      right.maxStack
  );
}

function slotsForQuantity(
  quantity: number,
  maxStack: number,
): number {
  if (quantity <= 0) {
    return 0;
  }

  return Math.ceil(
    quantity /
      maxStack,
  );
}

function rejected(
  reason:
    RewardGrantRejectionReason,
  id: string,
): RewardGrantRejected {
  return Object.freeze({
    granted: false,
    reason,
    id,
  });
}

/**
 * Aplica Reward a Inventory + CurrencyAccount com preflight all-or-nothing.
 *
 * Como Reward já proíbe IDs duplicados, cada destino é alterado no máximo uma
 * vez durante a fase de commit.
 */
export function grantRewardAtomically(
  reward:
    Reward,
  context:
    RewardGrantContext,
): RewardGrantResult {
  const accounts =
    new Map<
      CurrencyId,
      CurrencyAccount
    >();

  for (
    const account of
    context.currencyAccounts
  ) {
    if (
      accounts.has(
        account.currencyId,
      )
    ) {
      throw new RewardGrantIntegrationError(
        "duplicate-currency-account",
        `CurrencyAccount duplicada para "${account.currencyId}".`,
      );
    }

    accounts.set(
      account.currencyId,
      account,
    );
  }

  let totalCurrencyUnits =
    0;

  for (
    const entry of
    reward.getCurrencyEntries()
  ) {
    const account =
      accounts.get(
        entry.currencyId,
      );

    if (
      account === undefined
    ) {
      return rejected(
        "missing-currency-account",
        entry.currencyId,
      );
    }

    const next =
      account.balance +
      entry.amount;

    if (
      !Number.isSafeInteger(
        next,
      )
    ) {
      return rejected(
        "currency-overflow",
        entry.currencyId,
      );
    }

    totalCurrencyUnits +=
      entry.amount;

    if (
      !Number.isSafeInteger(
        totalCurrencyUnits,
      )
    ) {
      return rejected(
        "currency-overflow",
        entry.currencyId,
      );
    }
  }

  let additionalSlots = 0;
  let totalItemUnits = 0;

  for (
    const entry of
    reward.getItemEntries()
  ) {
    const item =
      context
        .itemDefinitions
        .get(
          entry.itemId,
        );

    if (
      item === undefined
    ) {
      return rejected(
        "missing-item-definition",
        entry.itemId,
      );
    }

    if (
      item.id !==
      entry.itemId
    ) {
      throw new RewardGrantIntegrationError(
        "item-map-mismatch",
        `Item map key "${entry.itemId}" aponta para Item "${item.id}".`,
      );
    }

    const existing =
      context.inventory
        .getItem(
          entry.itemId,
        );

    if (
      existing !== null &&
      !sameItemDefinition(
        existing,
        item,
      )
    ) {
      return rejected(
        "item-definition-conflict",
        entry.itemId,
      );
    }

    const currentQuantity =
      context.inventory
        .getQuantity(
          entry.itemId,
        );

    const nextQuantity =
      currentQuantity +
      entry.quantity;

    if (
      !Number.isSafeInteger(
        nextQuantity,
      )
    ) {
      return rejected(
        "quantity-overflow",
        entry.itemId,
      );
    }

    const oldSlots =
      slotsForQuantity(
        currentQuantity,
        item.maxStack,
      );

    const newSlots =
      slotsForQuantity(
        nextQuantity,
        item.maxStack,
      );

    additionalSlots +=
      newSlots -
      oldSlots;

    if (
      !Number.isSafeInteger(
        additionalSlots,
      )
    ) {
      return rejected(
        "quantity-overflow",
        entry.itemId,
      );
    }

    totalItemUnits +=
      entry.quantity;

    if (
      !Number.isSafeInteger(
        totalItemUnits,
      )
    ) {
      return rejected(
        "quantity-overflow",
        entry.itemId,
      );
    }
  }

  const nextTotalUnits =
    context.inventory
      .totalUnits +
    totalItemUnits;

  if (
    !Number.isSafeInteger(
      nextTotalUnits,
    )
  ) {
    return rejected(
      "quantity-overflow",
      "inventory.totalUnits",
    );
  }

  const maxSlots =
    context.inventory
      .maxSlots;

  if (
    maxSlots !== null &&
    context.inventory
      .occupiedSlots +
      additionalSlots >
      maxSlots
  ) {
    return rejected(
      "inventory-capacity",
      "inventory",
    );
  }

  for (
    const entry of
    reward.getCurrencyEntries()
  ) {
    accounts
      .get(
        entry.currencyId,
      )!
      .credit(
        entry.amount,
      );
  }

  for (
    const entry of
    reward.getItemEntries()
  ) {
    context.inventory.add(
      context
        .itemDefinitions
        .get(
          entry.itemId,
        )!,
      entry.quantity,
    );
  }

  return Object.freeze({
    granted: true,
    currencyEntries:
      reward.currencyCount,
    itemEntries:
      reward.itemCount,
    totalCurrencyUnits,
    totalItemUnits,
  });
}
