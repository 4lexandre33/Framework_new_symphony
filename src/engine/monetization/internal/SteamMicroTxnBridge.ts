import type { TransactionReceiptDTO } from "../../../contracts/monetization/types";

const MAX_PENDING_ORDERS = 64;

/**
 * Livro de ordens PENDENTES devolvidas pelo `PurchaseProvider` (servidor que
 * chama ISteamMicroTxn/InitTxn). G119: não cria ordens nem aprova nada
 * sozinho — só guarda o que o servidor iniciou até a finalização.
 */
export class SteamMicroTxnBridge {
  private readonly pendingOrders = new Map<string, TransactionReceiptDTO>();

  public addPending(receipt: TransactionReceiptDTO): boolean {
    if (this.pendingOrders.size >= MAX_PENDING_ORDERS && !this.pendingOrders.has(receipt.orderId)) {
      return false;
    }
    this.pendingOrders.set(receipt.orderId, receipt);
    return true;
  }

  public getPending(orderId: string): TransactionReceiptDTO | null {
    return this.pendingOrders.get(orderId) ?? null;
  }

  public take(orderId: string): TransactionReceiptDTO | null {
    const pending = this.pendingOrders.get(orderId) ?? null;
    this.pendingOrders.delete(orderId);
    return pending;
  }

  public getPendingOrders(): ReadonlyArray<TransactionReceiptDTO> {
    return Array.from(this.pendingOrders.values());
  }

  public clear(): void {
    this.pendingOrders.clear();
  }
}
