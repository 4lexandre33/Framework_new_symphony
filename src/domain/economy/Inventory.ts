import {
  Item,
} from "./Item";

import type {
  ItemId,
} from "./Item";

export type InventoryErrorCode =
  | "invalid-capacity"
  | "invalid-quantity"
  | "capacity-exceeded"
  | "item-definition-conflict"
  | "quantity-overflow";

export class InventoryError
  extends Error {
  public readonly name =
    "InventoryError";

  public constructor(
    public readonly code:
      InventoryErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface InventoryCreateOptions {
  /**
   * null = capacidade ilimitada.
   *
   * Quando finito, um slot comporta até Item.maxStack unidades da mesma
   * definição. A quantidade é armazenada agregada; stacks físicos não são
   * materializados em arrays no caminho comum.
   */
  readonly maxSlots?:
    number | null;
}

export interface InventorySnapshotEntry {
  readonly itemId: ItemId;
  readonly quantity: number;
}

export interface InventorySnapshot {
  readonly maxSlots:
    number | null;
  readonly occupiedSlots: number;
  readonly totalUnits: number;
  readonly entries:
    readonly InventorySnapshotEntry[];
}

interface InventoryEntry {
  readonly item: Item;
  quantity: number;
}

function assertCapacity(
  maxSlots: number | null,
): void {
  if (maxSlots === null) {
    return;
  }

  if (
    !Number.isSafeInteger(
      maxSlots,
    ) ||
    maxSlots < 1
  ) {
    throw new InventoryError(
      "invalid-capacity",
      "maxSlots deve ser null ou um inteiro seguro maior ou igual a 1.",
    );
  }
}

function assertQuantity(
  quantity: number,
): void {
  if (
    !Number.isSafeInteger(
      quantity,
    ) ||
    quantity < 1
  ) {
    throw new InventoryError(
      "invalid-quantity",
      "quantity deve ser um inteiro seguro maior ou igual a 1.",
    );
  }
}

function slotsForQuantity(
  quantity: number,
  maxStack: number,
): number {
  if (quantity <= 0) {
    return 0;
  }

  return Math.ceil(
    quantity / maxStack,
  );
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

/**
 * Inventário puro e dimension-agnostic.
 *
 * Estrutura:
 * - Map<ItemId, InventoryEntry> para lookup O(1) médio;
 * - quantidade agregada por item;
 * - occupiedSlots e totalUnits mantidos incrementalmente.
 *
 * Inventory não conhece posição, mundo, UI, renderer, física, input, Steam,
 * Tauri ou persistência. Portanto pode ser reutilizado sem alteração em jogos
 * 2D, 2.5D e 3D.
 *
 * As operações add/remove/get/has não produzem arrays ou snapshots. A única
 * alocação estrutural esperada no caminho comum ocorre na primeira inserção de
 * um ItemId, quando a entrada do Map é criada.
 */
export class Inventory {
  private readonly entries =
    new Map<
      ItemId,
      InventoryEntry
    >();

  private occupiedSlotsValue =
    0;

  private totalUnitsValue =
    0;

  private readonly maxSlotsValue:
    number | null;

  public constructor(
    options:
      InventoryCreateOptions = {},
  ) {
    const maxSlots =
      options.maxSlots ??
      null;

    assertCapacity(maxSlots);

    this.maxSlotsValue =
      maxSlots;
  }

  public get maxSlots():
    number | null {
    return this.maxSlotsValue;
  }

  public get occupiedSlots():
    number {
    return this.occupiedSlotsValue;
  }

  public get totalUnits():
    number {
    return this.totalUnitsValue;
  }

  public get uniqueItemCount():
    number {
    return this.entries.size;
  }

  public get isEmpty():
    boolean {
    return this.entries.size === 0;
  }

  public get availableSlots():
    number | null {
    if (
      this.maxSlotsValue === null
    ) {
      return null;
    }

    return (
      this.maxSlotsValue -
      this.occupiedSlotsValue
    );
  }

  public has(
    itemId: ItemId,
    minimumQuantity: number = 1,
  ): boolean {
    assertQuantity(
      minimumQuantity,
    );

    const entry =
      this.entries.get(itemId);

    return (
      entry !== undefined &&
      entry.quantity >=
        minimumQuantity
    );
  }

  public getQuantity(
    itemId: ItemId,
  ): number {
    return (
      this.entries.get(itemId)
        ?.quantity ??
      0
    );
  }

  public getItem(
    itemId: ItemId,
  ): Item | null {
    return (
      this.entries.get(itemId)
        ?.item ??
      null
    );
  }

  public canAdd(
    item: Item,
    quantity: number = 1,
  ): boolean {
    assertQuantity(quantity);

    const existing =
      this.entries.get(item.id);

    if (
      existing !== undefined &&
      !sameItemDefinition(
        existing.item,
        item,
      )
    ) {
      return false;
    }

    const currentQuantity =
      existing?.quantity ?? 0;

    const nextQuantity =
      currentQuantity +
      quantity;

    if (
      !Number.isSafeInteger(
        nextQuantity,
      )
    ) {
      return false;
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

    const additionalSlots =
      newSlots - oldSlots;

    return (
      this.maxSlotsValue ===
        null ||
      this.occupiedSlotsValue +
        additionalSlots <=
        this.maxSlotsValue
    );
  }

  /**
   * Adiciona unidades e retorna a nova quantidade total daquele ItemId.
   */
  public add(
    item: Item,
    quantity: number = 1,
  ): number {
    assertQuantity(quantity);

    const existing =
      this.entries.get(item.id);

    if (
      existing !== undefined &&
      !sameItemDefinition(
        existing.item,
        item,
      )
    ) {
      throw new InventoryError(
        "item-definition-conflict",
        `ItemId "${item.id}" já existe no Inventory com definição diferente.`,
      );
    }

    const currentQuantity =
      existing?.quantity ?? 0;

    const nextQuantity =
      currentQuantity +
      quantity;

    if (
      !Number.isSafeInteger(
        nextQuantity,
      )
    ) {
      throw new InventoryError(
        "quantity-overflow",
        `Quantidade de "${item.id}" excedeu o limite de inteiro seguro.`,
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

    const additionalSlots =
      newSlots - oldSlots;

    if (
      this.maxSlotsValue !==
        null &&
      this.occupiedSlotsValue +
        additionalSlots >
        this.maxSlotsValue
    ) {
      throw new InventoryError(
        "capacity-exceeded",
        `Inventory sem slots suficientes para adicionar ${quantity} unidade(s) de "${item.id}".`,
      );
    }

    const nextTotalUnits =
      this.totalUnitsValue +
      quantity;

    if (
      !Number.isSafeInteger(
        nextTotalUnits,
      )
    ) {
      throw new InventoryError(
        "quantity-overflow",
        "totalUnits excedeu o limite de inteiro seguro.",
      );
    }

    if (existing === undefined) {
      this.entries.set(
        item.id,
        {
          item,
          quantity:
            nextQuantity,
        },
      );
    } else {
      existing.quantity =
        nextQuantity;
    }

    this.occupiedSlotsValue +=
      additionalSlots;

    this.totalUnitsValue =
      nextTotalUnits;

    return nextQuantity;
  }

  /**
   * Remove até `quantity` unidades e retorna a quantidade restante do ItemId.
   *
   * Remover mais do que existe é intencionalmente saturado em zero.
   */
  public remove(
    itemId: ItemId,
    quantity: number = 1,
  ): number {
    assertQuantity(quantity);

    const existing =
      this.entries.get(itemId);

    if (existing === undefined) {
      return 0;
    }

    const currentQuantity =
      existing.quantity;

    const removedQuantity =
      Math.min(
        quantity,
        currentQuantity,
      );

    const nextQuantity =
      currentQuantity -
      removedQuantity;

    const oldSlots =
      slotsForQuantity(
        currentQuantity,
        existing.item.maxStack,
      );

    const newSlots =
      slotsForQuantity(
        nextQuantity,
        existing.item.maxStack,
      );

    this.occupiedSlotsValue -=
      oldSlots - newSlots;

    this.totalUnitsValue -=
      removedQuantity;

    if (nextQuantity === 0) {
      this.entries.delete(
        itemId,
      );
      return 0;
    }

    existing.quantity =
      nextQuantity;

    return nextQuantity;
  }

  public clear(): void {
    this.entries.clear();
    this.occupiedSlotsValue = 0;
    this.totalUnitsValue = 0;
  }

  /**
   * Iteração sem materializar array intermediário.
   */
  public forEach(
    visitor: (
      item: Item,
      quantity: number,
    ) => void,
  ): void {
    for (
      const entry of
      this.entries.values()
    ) {
      visitor(
        entry.item,
        entry.quantity,
      );
    }
  }

  /**
   * Snapshot determinístico sob demanda.
   *
   * Aloca e ordena entradas somente quando explicitamente solicitado
   * (save/UI/debug), nunca no caminho comum de mutação.
   */
  public toSnapshot():
    InventorySnapshot {
    const snapshotEntries:
      InventorySnapshotEntry[] =
        [];

    for (
      const entry of
      this.entries.values()
    ) {
      snapshotEntries.push({
        itemId:
          entry.item.id,
        quantity:
          entry.quantity,
      });
    }

    snapshotEntries.sort(
      (left, right) =>
        left.itemId <
        right.itemId
          ? -1
          : left.itemId >
              right.itemId
            ? 1
            : 0,
    );

    return {
      maxSlots:
        this.maxSlotsValue,
      occupiedSlots:
        this.occupiedSlotsValue,
      totalUnits:
        this.totalUnitsValue,
      entries:
        snapshotEntries,
    };
  }
}
