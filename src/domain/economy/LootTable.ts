import {
  createDomainId,
} from "../entities/DomainId";

import type {
  DomainId,
} from "../entities/DomainId";

import {
  LootEntry,
} from "./LootEntry";

import type {
  LootEntryId,
  LootEntrySnapshot,
} from "./LootEntry";

import {
  DEFAULT_REWARD_POLICY,
  RewardPolicy,
} from "./RewardPolicy";

import type {
  Reward,
} from "./Reward";

export type LootTableId =
  DomainId<"loot-table">;

export interface LootRandomSource {
  /**
   * Deve retornar valor finito no intervalo [0, 1).
   */
  nextFloat(): number;
}

export interface LootRollResult {
  readonly entryId:
    LootEntryId;
  readonly reward:
    Reward;
}

export interface LootTableSnapshot {
  readonly id:
    string;
  readonly entries:
    readonly LootEntrySnapshot[];
}

export type LootTableErrorCode =
  | "empty-table"
  | "duplicate-entry"
  | "weight-overflow"
  | "invalid-random-value"
  | "rolls-exceed-entries"
  | "selection-invariant"
  | "invalid-snapshot";

export class LootTableError
  extends Error {
  public readonly name =
    "LootTableError";

  public constructor(
    public readonly code:
      LootTableErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function compareLootEntryId(
  left:
    LootEntryId,
  right:
    LootEntryId,
): number {
  return left < right
    ? -1
    : left > right
      ? 1
      : 0;
}

function readUnitRandom(
  source:
    LootRandomSource,
): number {
  const value =
    source.nextFloat();

  if (
    !Number.isFinite(
      value,
    ) ||
    value < 0 ||
    value >= 1
  ) {
    throw new LootTableError(
      "invalid-random-value",
      `LootRandomSource retornou valor fora de [0, 1): ${String(value)}.`,
    );
  }

  return value;
}

export function createLootTableId(
  value: string,
): LootTableId {
  return createDomainId<
    "loot-table"
  >(value);
}

/**
 * Tabela ponderada determinística em relação à sequência fornecida pelo RNG.
 *
 * Nunca consulta RNG global. A fonte é sempre injetada.
 */
export class LootTable {
  public readonly id:
    LootTableId;

  private readonly entries:
    readonly LootEntry[];

  private readonly totalWeightValue:
    number;

  public constructor(
    id:
      LootTableId,
    entries:
      readonly LootEntry[],
  ) {
    if (
      entries.length === 0
    ) {
      throw new LootTableError(
        "empty-table",
        "LootTable exige ao menos uma entrada.",
      );
    }

    const ids =
      new Set<LootEntryId>();

    const copy =
      [...entries];

    let totalWeight =
      0;

    for (
      const entry of copy
    ) {
      if (
        ids.has(
          entry.id,
        )
      ) {
        throw new LootTableError(
          "duplicate-entry",
          `LootEntryId duplicado: "${entry.id}".`,
        );
      }

      ids.add(entry.id);

      totalWeight +=
        entry.weight;

      if (
        !Number.isSafeInteger(
          totalWeight,
        )
      ) {
        throw new LootTableError(
          "weight-overflow",
          "Soma de pesos da LootTable excedeu o limite de inteiro seguro.",
        );
      }
    }

    copy.sort(
      (left, right) =>
        compareLootEntryId(
          left.id,
          right.id,
        ),
    );

    this.id = id;
    this.entries =
      Object.freeze(copy);
    this.totalWeightValue =
      totalWeight;
  }

  public static fromSnapshot(
    snapshot:
      LootTableSnapshot,
  ): LootTable {
    try {
      return new LootTable(
        createLootTableId(
          snapshot.id,
        ),
        snapshot.entries.map(
          (entry) =>
            LootEntry.fromSnapshot(
              entry,
            ),
        ),
      );
    } catch (error) {
      throw new LootTableError(
        "invalid-snapshot",
        `LootTableSnapshot inválido: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );
    }
  }

  public get size():
    number {
    return this.entries.length;
  }

  public get totalWeight():
    number {
    return this.totalWeightValue;
  }

  public getEntries():
    readonly LootEntry[] {
    return this.entries;
  }

  private selectWithReplacement(
    source:
      LootRandomSource,
  ): LootEntry {
    const target =
      readUnitRandom(source) *
      this.totalWeightValue;

    let cumulative =
      0;

    for (
      const entry of
      this.entries
    ) {
      cumulative +=
        entry.weight;

      if (
        target <
        cumulative
      ) {
        return entry;
      }
    }

    throw new LootTableError(
      "selection-invariant",
      "LootTable não encontrou entrada apesar de pesos válidos.",
    );
  }

  private selectWithoutReplacement(
    source:
      LootRandomSource,
    selected:
      ReadonlySet<LootEntryId>,
  ): LootEntry {
    let availableWeight =
      0;

    for (
      const entry of
      this.entries
    ) {
      if (
        !selected.has(
          entry.id,
        )
      ) {
        availableWeight +=
          entry.weight;
      }
    }

    const target =
      readUnitRandom(source) *
      availableWeight;

    let cumulative =
      0;

    for (
      const entry of
      this.entries
    ) {
      if (
        selected.has(
          entry.id,
        )
      ) {
        continue;
      }

      cumulative +=
        entry.weight;

      if (
        target <
        cumulative
      ) {
        return entry;
      }
    }

    throw new LootTableError(
      "selection-invariant",
      "LootTable não encontrou entrada disponível.",
    );
  }

  /**
   * Resolve rolls e retorna apenas resultados declarativos.
   *
   * Nenhuma recompensa é aplicada automaticamente.
   */
  public roll(
    source:
      LootRandomSource,
    policy:
      RewardPolicy =
        DEFAULT_REWARD_POLICY,
  ): readonly LootRollResult[] {
    if (
      policy.replacement ===
        "without-replacement" &&
      policy.rolls >
        this.entries.length
    ) {
      throw new LootTableError(
        "rolls-exceed-entries",
        "RewardPolicy sem reposição não pode solicitar mais rolls que entradas.",
      );
    }

    const results:
      LootRollResult[] = [];

    if (
      policy.replacement ===
      "with-replacement"
    ) {
      for (
        let index = 0;
        index < policy.rolls;
        index += 1
      ) {
        const entry =
          this.selectWithReplacement(
            source,
          );

        results.push(
          Object.freeze({
            entryId:
              entry.id,
            reward:
              entry.reward,
          }),
        );
      }

      return Object.freeze(
        results,
      );
    }

    const selected =
      new Set<LootEntryId>();

    for (
      let index = 0;
      index < policy.rolls;
      index += 1
    ) {
      const entry =
        this.selectWithoutReplacement(
          source,
          selected,
        );

      selected.add(
        entry.id,
      );

      results.push(
        Object.freeze({
          entryId:
            entry.id,
          reward:
            entry.reward,
        }),
      );
    }

    return Object.freeze(
      results,
    );
  }

  public toSnapshot():
    LootTableSnapshot {
    return Object.freeze({
      id: this.id,
      entries:
        Object.freeze(
          this.entries.map(
            (entry) =>
              entry.toSnapshot(),
          ),
        ),
    });
  }
}
