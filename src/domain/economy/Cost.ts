import {
  createCurrencyId,
} from "./CurrencyId";

import type {
  CurrencyId,
} from "./CurrencyId";

import type {
  CurrencyAccount,
} from "./CurrencyAccount";

export interface CostEntry {
  readonly currencyId:
    CurrencyId;
  readonly amount:
    number;
}

export interface CostSnapshot {
  readonly entries:
    readonly {
      readonly currencyId:
        string;
      readonly amount:
        number;
    }[];
}

export type CostErrorCode =
  | "empty-cost"
  | "invalid-amount"
  | "duplicate-currency"
  | "duplicate-account"
  | "transaction-invariant"
  | "invalid-snapshot";

export class CostError
  extends Error {
  public readonly name =
    "CostError";

  public constructor(
    public readonly code:
      CostErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function assertAmount(
  amount: number,
): void {
  if (
    !Number.isSafeInteger(
      amount,
    ) ||
    amount < 1
  ) {
    throw new CostError(
      "invalid-amount",
      "Cost amount deve ser inteiro seguro maior ou igual a 1.",
    );
  }
}

function compareCurrencyId(
  left: CurrencyId,
  right: CurrencyId,
): number {
  return left < right
    ? -1
    : left > right
      ? 1
      : 0;
}

/**
 * Custo imutável multi-moeda.
 *
 * O pagamento é validado completamente antes do primeiro débito.
 */
export class Cost {
  private readonly entries:
    readonly CostEntry[];

  public constructor(
    entries:
      readonly CostEntry[],
  ) {
    if (
      entries.length === 0
    ) {
      throw new CostError(
        "empty-cost",
        "Cost exige ao menos uma entrada.",
      );
    }

    const seen =
      new Set<CurrencyId>();

    const copy:
      CostEntry[] = [];

    for (
      const entry of entries
    ) {
      assertAmount(
        entry.amount,
      );

      if (
        seen.has(
          entry.currencyId,
        )
      ) {
        throw new CostError(
          "duplicate-currency",
          `CurrencyId duplicada em Cost: "${entry.currencyId}".`,
        );
      }

      seen.add(
        entry.currencyId,
      );

      copy.push(
        Object.freeze({
          currencyId:
            entry.currencyId,
          amount:
            entry.amount,
        }),
      );
    }

    copy.sort(
      (left, right) =>
        compareCurrencyId(
          left.currencyId,
          right.currencyId,
        ),
    );

    this.entries =
      Object.freeze(copy);
  }

  public static fromSnapshot(
    snapshot:
      CostSnapshot,
  ): Cost {
    try {
      return new Cost(
        snapshot.entries.map(
          (entry) => ({
            currencyId:
              createCurrencyId(
                entry.currencyId,
              ),
            amount:
              entry.amount,
          }),
        ),
      );
    } catch (error) {
      throw new CostError(
        "invalid-snapshot",
        `CostSnapshot inválido: ${
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

  public getEntries():
    readonly CostEntry[] {
    return this.entries;
  }

  private indexAccounts(
    accounts:
      readonly CurrencyAccount[],
  ): Map<
    CurrencyId,
    CurrencyAccount
  > {
    const byCurrency =
      new Map<
        CurrencyId,
        CurrencyAccount
      >();

    for (
      const account of
      accounts
    ) {
      if (
        byCurrency.has(
          account.currencyId,
        )
      ) {
        throw new CostError(
          "duplicate-account",
          `Mais de uma CurrencyAccount fornecida para "${account.currencyId}".`,
        );
      }

      byCurrency.set(
        account.currencyId,
        account,
      );
    }

    return byCurrency;
  }

  public canAfford(
    accounts:
      readonly CurrencyAccount[],
  ): boolean {
    const byCurrency =
      this.indexAccounts(
        accounts,
      );

    for (
      const entry of
      this.entries
    ) {
      const account =
        byCurrency.get(
          entry.currencyId,
        );

      if (
        account === undefined ||
        account.balance <
          entry.amount
      ) {
        return false;
      }
    }

    return true;
  }

  /**
   * Pagamento atômico multi-moeda.
   *
   * Todas as contas/saldos são validados antes da primeira mutação.
   * false significa custo não pago e nenhuma conta alterada.
   */
  public tryPay(
    accounts:
      readonly CurrencyAccount[],
  ): boolean {
    const byCurrency =
      this.indexAccounts(
        accounts,
      );

    for (
      const entry of
      this.entries
    ) {
      const account =
        byCurrency.get(
          entry.currencyId,
        );

      if (
        account === undefined ||
        account.balance <
          entry.amount
      ) {
        return false;
      }
    }

    for (
      const entry of
      this.entries
    ) {
      const account =
        byCurrency.get(
          entry.currencyId,
        );

      if (
        account === undefined ||
        !account.tryDebit(
          entry.amount,
        )
      ) {
        throw new CostError(
          "transaction-invariant",
          "Cost.tryPay perdeu a pré-condição após validação síncrona.",
        );
      }
    }

    return true;
  }

  public toSnapshot():
    CostSnapshot {
    const snapshotEntries =
      this.entries.map(
        (entry) =>
          Object.freeze({
            currencyId:
              entry.currencyId,
            amount:
              entry.amount,
          }),
      );

    return Object.freeze({
      entries:
        Object.freeze(
          snapshotEntries,
        ),
    });
  }
}
