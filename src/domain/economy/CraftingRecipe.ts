import {
  createDomainId,
} from "../entities/DomainId";

import type {
  DomainId,
} from "../entities/DomainId";

import {
  createItemId,
} from "./Item";

import type {
  ItemId,
} from "./Item";

import {
  Cost,
} from "./Cost";

import type {
  CostSnapshot,
} from "./Cost";

import {
  Reward,
} from "./Reward";

import type {
  RewardSnapshot,
} from "./Reward";

export type CraftingRecipeId =
  DomainId<
    "crafting-recipe"
  >;

export interface CraftingIngredient {
  readonly itemId:
    ItemId;
  readonly quantity:
    number;
}

export interface CraftingRecipeCreateOptions {
  readonly id:
    CraftingRecipeId;
  readonly ingredients?:
    readonly CraftingIngredient[];
  readonly cost?:
    Cost | null;
  readonly reward:
    Reward;
}

export interface CraftingRecipeSnapshot {
  readonly id:
    string;
  readonly ingredients:
    readonly {
      readonly itemId:
        string;
      readonly quantity:
        number;
    }[];
  readonly cost:
    CostSnapshot | null;
  readonly reward:
    RewardSnapshot;
}

export type CraftingRecipeErrorCode =
  | "empty-requirements"
  | "invalid-quantity"
  | "duplicate-ingredient"
  | "invalid-snapshot";

export class CraftingRecipeError
  extends Error {
  public readonly name =
    "CraftingRecipeError";

  public constructor(
    public readonly code:
      CraftingRecipeErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function createCraftingRecipeId(
  value: string,
): CraftingRecipeId {
  return createDomainId<
    "crafting-recipe"
  >(value);
}

function compareItemId(
  left: ItemId,
  right: ItemId,
): number {
  return left < right
    ? -1
    : left > right
      ? 1
      : 0;
}

/**
 * Definição imutável de crafting.
 *
 * Declara requisitos e resultado, mas não altera containers runtime.
 */
export class CraftingRecipe {
  public readonly id:
    CraftingRecipeId;

  private readonly ingredients:
    readonly CraftingIngredient[];

  public readonly cost:
    Cost | null;

  public readonly reward:
    Reward;

  public constructor(
    options:
      CraftingRecipeCreateOptions,
  ) {
    const source =
      options.ingredients ?? [];

    const cost =
      options.cost ?? null;

    if (
      source.length === 0 &&
      cost === null
    ) {
      throw new CraftingRecipeError(
        "empty-requirements",
        "CraftingRecipe exige ao menos um ingrediente ou Cost.",
      );
    }

    const ids =
      new Set<ItemId>();

    const copy:
      CraftingIngredient[] = [];

    for (
      const ingredient of
      source
    ) {
      if (
        !Number.isSafeInteger(
          ingredient.quantity,
        ) ||
        ingredient.quantity < 1
      ) {
        throw new CraftingRecipeError(
          "invalid-quantity",
          "CraftingIngredient.quantity deve ser inteiro seguro maior ou igual a 1.",
        );
      }

      if (
        ids.has(
          ingredient.itemId,
        )
      ) {
        throw new CraftingRecipeError(
          "duplicate-ingredient",
          `ItemId duplicado nos ingredientes: "${ingredient.itemId}".`,
        );
      }

      ids.add(
        ingredient.itemId,
      );

      copy.push(
        Object.freeze({
          itemId:
            ingredient.itemId,
          quantity:
            ingredient.quantity,
        }),
      );
    }

    copy.sort(
      (left, right) =>
        compareItemId(
          left.itemId,
          right.itemId,
        ),
    );

    this.id = options.id;
    this.ingredients =
      Object.freeze(copy);
    this.cost = cost;
    this.reward =
      options.reward;
  }

  public static fromSnapshot(
    snapshot:
      CraftingRecipeSnapshot,
  ): CraftingRecipe {
    try {
      return new CraftingRecipe({
        id:
          createCraftingRecipeId(
            snapshot.id,
          ),
        ingredients:
          snapshot.ingredients.map(
            (ingredient) => ({
              itemId:
                createItemId(
                  ingredient.itemId,
                ),
              quantity:
                ingredient.quantity,
            }),
          ),
        cost:
          snapshot.cost === null
            ? null
            : Cost.fromSnapshot(
                snapshot.cost,
              ),
        reward:
          Reward.fromSnapshot(
            snapshot.reward,
          ),
      });
    } catch (error) {
      throw new CraftingRecipeError(
        "invalid-snapshot",
        `CraftingRecipeSnapshot inválido: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );
    }
  }

  public get ingredientCount():
    number {
    return this.ingredients.length;
  }

  public getIngredients():
    readonly CraftingIngredient[] {
    return this.ingredients;
  }

  public toSnapshot():
    CraftingRecipeSnapshot {
    return Object.freeze({
      id: this.id,
      ingredients:
        Object.freeze(
          this.ingredients.map(
            (ingredient) =>
              Object.freeze({
                itemId:
                  ingredient.itemId,
                quantity:
                  ingredient.quantity,
              }),
          ),
        ),
      cost:
        this.cost === null
          ? null
          : this.cost.toSnapshot(),
      reward:
        this.reward.toSnapshot(),
    });
  }
}
