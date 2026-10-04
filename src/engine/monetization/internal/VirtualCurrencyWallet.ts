import type { VirtualWalletDTO } from "../../../contracts/monetization/types";

export interface WalletTransactionEntry {
  readonly currencyId: string;
  readonly delta: number;
  readonly balanceAfter: number;
  readonly timestamp: number;
  readonly reason: string;
}

export class VirtualCurrencyWallet {
  private readonly currencies = new Map<string, number>();
  private readonly transactionHistory: WalletTransactionEntry[] = [];

  public constructor(private readonly playerId = "local_player") {}

  public getBalance(currencyId: string): number {
    return this.currencies.get(currencyId) ?? 0;
  }

  public credit(currencyId: string, amount: number, reason = "credit"): number {
    if (amount <= 0) return this.getBalance(currencyId);

    const current = this.getBalance(currencyId);
    const updated = current + amount;
    this.currencies.set(currencyId, updated);

    this.recordTransaction(currencyId, amount, updated, reason);
    return updated;
  }

  public debit(currencyId: string, amount: number, reason = "debit"): boolean {
    if (amount <= 0) return false;

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
      reason,
    });
  }
}