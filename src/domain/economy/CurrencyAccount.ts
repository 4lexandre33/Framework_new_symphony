import {
  createCurrencyId,
} from "./CurrencyId";

import type {
  CurrencyId,
} from "./CurrencyId";

export interface CurrencyAccountCreateOptions {
  readonly currencyId:
    CurrencyId;
  readonly balance?:
    number;
}

export interface CurrencyAccountSnapshot {
  readonly currencyId:
    string;
  readonly balance:
    number;
}

export type CurrencyAccountErrorCode =
  | "invalid-balance"
  | "invalid-amount"
  | "balance-overflow"
  | "currency-mismatch"
  | "invalid-snapshot";

export class CurrencyAccountError
  extends Error {
  public readonly name =
    "CurrencyAccountError";

  public constructor(
    public readonly code:
      CurrencyAccountErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function assertBalance(
  value: number,
): void {
  if (
    !Number.isSafeInteger(
      value,
    ) ||
    value < 0
  ) {
    throw new CurrencyAccountError(
      "invalid-balance",
      "CurrencyAccount.balance deve ser inteiro seguro maior ou igual a zero.",
    );
  }
}

function assertAmount(
  value: number,
): void {
  if (
    !Number.isSafeInteger(
      value,
    ) ||
    value < 1
  ) {
    throw new CurrencyAccountError(
      "invalid-amount",
      "Currency amount deve ser inteiro seguro maior ou igual a 1.",
    );
  }
}

/**
 * Saldo runtime de uma única CurrencyId.
 *
 * Não conhece loja, pagamento real, plataforma, usuário ou monetização.
 */
export class CurrencyAccount {
  public readonly currencyId:
    CurrencyId;

  private balanceValue:
    number;

  public constructor(
    options:
      CurrencyAccountCreateOptions,
  ) {
    const balance =
      options.balance ?? 0;

    assertBalance(balance);

    this.currencyId =
      options.currencyId;
    this.balanceValue =
      balance;
  }

  public static fromSnapshot(
    snapshot:
      CurrencyAccountSnapshot,
  ): CurrencyAccount {
    try {
      return new CurrencyAccount({
        currencyId:
          createCurrencyId(
            snapshot.currencyId,
          ),
        balance:
          snapshot.balance,
      });
    } catch (error) {
      throw new CurrencyAccountError(
        "invalid-snapshot",
        `CurrencyAccountSnapshot inválido: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );
    }
  }

  public get balance():
    number {
    return this.balanceValue;
  }

  public canDebit(
    amount: number,
  ): boolean {
    assertAmount(amount);

    return (
      this.balanceValue >=
      amount
    );
  }

  /**
   * Crédito estrito.
   *
   * Retorna o novo saldo. Overflow não altera o estado.
   */
  public credit(
    amount: number,
  ): number {
    assertAmount(amount);

    const next =
      this.balanceValue +
      amount;

    if (
      !Number.isSafeInteger(
        next,
      )
    ) {
      throw new CurrencyAccountError(
        "balance-overflow",
        `Saldo de "${this.currencyId}" excedeu o limite de inteiro seguro.`,
      );
    }

    this.balanceValue =
      next;

    return this.balanceValue;
  }

  /**
   * Débito atômico all-or-nothing.
   *
   * false = saldo insuficiente e nenhuma mutação.
   */
  public tryDebit(
    amount: number,
  ): boolean {
    assertAmount(amount);

    if (
      this.balanceValue <
      amount
    ) {
      return false;
    }

    this.balanceValue -=
      amount;

    return true;
  }

  /**
   * Transferência atômica entre contas da mesma moeda.
   *
   * Valida saldo e overflow do destino antes de qualquer mutação.
   */
  public tryTransferTo(
    target:
      CurrencyAccount,
    amount: number,
  ): boolean {
    assertAmount(amount);

    if (
      target.currencyId !==
      this.currencyId
    ) {
      throw new CurrencyAccountError(
        "currency-mismatch",
        `Transferência exige a mesma CurrencyId: "${this.currencyId}" != "${target.currencyId}".`,
      );
    }

    if (
      target === this
    ) {
      return true;
    }

    if (
      this.balanceValue <
      amount
    ) {
      return false;
    }

    const targetNext =
      target.balanceValue +
      amount;

    if (
      !Number.isSafeInteger(
        targetNext,
      )
    ) {
      throw new CurrencyAccountError(
        "balance-overflow",
        `Saldo de destino "${target.currencyId}" excederia o limite de inteiro seguro.`,
      );
    }

    this.balanceValue -=
      amount;

    target.balanceValue =
      targetNext;

    return true;
  }

  public toSnapshot():
    CurrencyAccountSnapshot {
    return Object.freeze({
      currencyId:
        this.currencyId,
      balance:
        this.balanceValue,
    });
  }
}
