import type { VirtualWalletDTO } from "../../../contracts/monetization/types";

export interface WalletTransactionEntry {
  readonly currencyId: string;
  readonly delta: number;
  readonly balanceAfter: number;
  readonly timestamp: number;
  readonly reason: string;
}

const CURRENCY_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/u;
const MAX_HISTORY = 1000;

export function isValidCurrencyId(value: unknown): value is string {
  return typeof value === "string" && CURRENCY_ID_PATTERN.test(value);
}

/** G120: quantia válida = inteiro seguro > 0 (rejeita NaN, ±Infinity, negativos, frações). */
export function isValidAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export class VirtualCurrencyWallet {
  private readonly currencies = new Map<string, number>();
  private readonly transactionHistory: WalletTransactionEntry[] = [];

  public constructor(private readonly playerId = "local_player") {}

  public getBalance(currencyId: string): number {
    return this.currencies.get(currencyId) ?? 0;
  }

  /**
   * Credita; entrada inválida ou estouro de inteiro seguro NÃO altera nada
   * e devolve o saldo atual. Use `tryCredit` para saber se mudou.
   */
  public credit(currencyId: string, amount: number, reason = "credit"): number {
    this.tryCredit(currencyId, amount, reason);
    return this.getBalance(currencyId);
  }

  public tryCredit(currencyId: string, amount: number, reason = "credit"): boolean {
    if (!isValidCurrencyId(currencyId) || !isValidAmount(amount)) return false;

    const current = this.getBalance(currencyId);
    const updated = current + amount;
    if (!Number.isSafeInteger(updated)) return false;

    this.currencies.set(currencyId, updated);
    this.recordTransaction(currencyId, amount, updated, reason);
    return true;
  }

  public debit(currencyId: string, amount: number, reason = "debit"): boolean {
    if (!isValidCurrencyId(currencyId) || !isValidAmount(amount)) return false;

    const current = this.getBalance(currencyId);
    if (current < amount) return false;

    const updated = current - amount;
    this.currencies.set(currencyId, updated);

    this.recordTransaction(currencyId, -amount, updated, reason);
    return true;
  }

  public getSnapshot(pendingTransactionsCount = 0): VirtualWalletDTO {
    const snapshotCurrencies: Record<string, number> = {};
    for (const [key, value] of this.currencies.entries()) {
      snapshotCurrencies[key] = value;
    }

    return {
      playerId: this.playerId,
      currencies: snapshotCurrencies,
      pendingTransactionsCount,
    };
  }

  public getHistory(): ReadonlyArray<WalletTransactionEntry> {
    return this.transactionHistory;
  }

  public clear(): void {
    this.currencies.clear();
    this.transactionHistory.length = 0;
  }

  private recordTransaction(
    currencyId: string,
    delta: number,
    balanceAfter: number,
    reason: string
  ): void {
    this.transactionHistory.push({
      currencyId,
      delta,
      balanceAfter,
      timestamp: Date.now(),
      reason: String(reason).slice(0, 128),
    });
    if (this.transactionHistory.length > MAX_HISTORY) {
      this.transactionHistory.shift();
    }
  }
}
