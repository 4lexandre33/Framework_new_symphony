import {
  createDomainId,
} from "../entities/DomainId";

import type {
  DomainId,
} from "../entities/DomainId";

import {
  Reward,
} from "./Reward";

import type {
  RewardSnapshot,
} from "./Reward";

export type LootEntryId =
  DomainId<"loot-entry">;

export interface LootEntryCreateOptions {
  readonly id:
    LootEntryId;
  readonly weight:
    number;
  readonly reward:
    Reward;
}

export interface LootEntrySnapshot {
  readonly id:
    string;
  readonly weight:
    number;
  readonly reward:
    RewardSnapshot;
}

export type LootEntryErrorCode =
  | "invalid-weight"
  | "invalid-snapshot";

export class LootEntryError
  extends Error {
  public readonly name =
    "LootEntryError";

  public constructor(
    public readonly code:
      LootEntryErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function createLootEntryId(
  value: string,
): LootEntryId {
  return createDomainId<
    "loot-entry"
  >(value);
}

/**
 * Entrada ponderada imutável de LootTable.
 */
export class LootEntry {
  public readonly id:
    LootEntryId;

  public readonly weight:
    number;

  public readonly reward:
    Reward;

  public constructor(
    options:
      LootEntryCreateOptions,
  ) {
    if (
      !Number.isSafeInteger(
        options.weight,
      ) ||
      options.weight < 1
    ) {
      throw new LootEntryError(
        "invalid-weight",
        "LootEntry.weight deve ser inteiro seguro maior ou igual a 1.",
      );
    }

    this.id = options.id;
    this.weight =
      options.weight;
    this.reward =
      options.reward;
  }

  public static fromSnapshot(
    snapshot:
      LootEntrySnapshot,
  ): LootEntry {
    try {
      return new LootEntry({
        id:
          createLootEntryId(
            snapshot.id,
          ),
        weight:
          snapshot.weight,
        reward:
          Reward.fromSnapshot(
            snapshot.reward,
          ),
      });
    } catch (error) {
      throw new LootEntryError(
        "invalid-snapshot",
        `LootEntrySnapshot inválido: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );
    }
  }

  public toSnapshot():
    LootEntrySnapshot {
    return Object.freeze({
      id: this.id,
      weight: this.weight,
      reward:
        this.reward.toSnapshot(),
    });
  }
}
