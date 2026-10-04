import {
  createDomainId,
} from "../entities/DomainId";

import type {
  DomainId,
} from "../entities/DomainId";

export type ItemId =
  DomainId<"item">;

export function createItemId(
  value: string,
): ItemId {
  return createDomainId<
    "item"
  >(value);
}

export interface ItemCreateOptions {
  readonly id: ItemId;
  readonly name: string;
  readonly description?:
    string | null;
  readonly maxStack: number;
}

export interface ItemSnapshot {
  readonly id: ItemId;
  readonly name: string;
  readonly description:
    string | null;
  readonly maxStack: number;
}

export class ItemInvariantError
  extends Error {
  public readonly name =
    "ItemInvariantError";

  public constructor(
    message: string,
  ) {
    super(message);
  }
}

const MAX_ITEM_NAME_LENGTH =
  120;

const MAX_ITEM_DESCRIPTION_LENGTH =
  2_048;

const MAX_STACK_LIMIT =
  1_000_000;

function assertText(
  value: string,
  fieldName: string,
  maxLength: number,
): void {
  if (
    value.length === 0 ||
    value.length >
      maxLength ||
    value !== value.trim()
  ) {
    throw new ItemInvariantError(
      `${fieldName} deve ser não vazio, sem whitespace nas extremidades e ter no máximo ${maxLength} caracteres.`,
    );
  }
}

function assertDescription(
  value: string | null,
): void {
  if (value === null) {
    return;
  }

  if (
    value.length >
      MAX_ITEM_DESCRIPTION_LENGTH ||
    value !== value.trim()
  ) {
    throw new ItemInvariantError(
      "description deve estar sem whitespace nas extremidades e ter no máximo 2048 caracteres.",
    );
  }
}

function assertMaxStack(
  maxStack: number,
): void {
  if (
    !Number.isSafeInteger(
      maxStack,
    ) ||
    maxStack < 1 ||
    maxStack >
      MAX_STACK_LIMIT
  ) {
    throw new ItemInvariantError(
      "maxStack deve ser um inteiro seguro entre 1 e 1000000.",
    );
  }
}

/**
 * Definição imutável de item.
 *
 * Não representa um slot de inventário nem uma instância física no mundo.
 * Quantidade, container e ownership entram em Inventory (Etapa 44.2).
 *
 * Também não contém asset, sprite, mesh, posição, collider ou renderer. Esses
 * dados pertencem a adapters/apresentação, mantendo Item compatível com
 * jogos 2D, 2.5D e 3D.
 */
export class Item {
  public readonly id:
    ItemId;

  public readonly name:
    string;

  public readonly description:
    string | null;

  public readonly maxStack:
    number;

  public constructor(
    options: ItemCreateOptions,
  ) {
    assertText(
      options.name,
      "name",
      MAX_ITEM_NAME_LENGTH,
    );

    const description =
      options.description ??
      null;

    assertDescription(
      description,
    );

    assertMaxStack(
      options.maxStack,
    );

    this.id = options.id;
    this.name = options.name;
    this.description =
      description;
    this.maxStack =
      options.maxStack;
  }

  public get stackable():
    boolean {
    return this.maxStack > 1;
  }

  public canStackQuantity(
    quantity: number,
  ): boolean {
    return (
      Number.isSafeInteger(
        quantity,
      ) &&
      quantity >= 1 &&
      quantity <=
        this.maxStack
    );
  }

  public toSnapshot():
    ItemSnapshot {
    return {
      id: this.id,
      name: this.name,
      description:
        this.description,
      maxStack:
        this.maxStack,
    };
  }
}
