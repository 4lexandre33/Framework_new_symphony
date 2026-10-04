import type { MonetizationItemDTO, TransactionReceiptDTO } from "../../../contracts/monetization/types";
import { InventoryReceiptValidator } from "./InventoryReceiptValidator";

export class SteamMicroTxnBridge {
  private readonly pendingOrders = new Map<string, TransactionReceiptDTO>();
  private readonly validator = new InventoryReceiptValidator();

  public createOrder(sku: string, item: MonetizationItemDTO, steamId: string): TransactionReceiptDTO {
    const timestamp = Date.now();
    const orderId = `order_${sku}_${timestamp}_${Math.floor(Math.random() * 1000)}`;
    const transId = `trans_steam_${timestamp}`;

    const signature = this.validator.calculateSignature(
      orderId,
      transId,
      steamId,
      sku,
      item.priceBaseCents
    );

    const receipt: TransactionReceiptDTO = {
      orderId,
      transId,
      steamId,
      sku,
      amountCents: item.priceBaseCents,
      status: "pending",
      timestamp,
      signature,
    };

    this.pendingOrders.set(orderId, receipt);
    return receipt;
  }

  public confirmOrder(orderId: string): TransactionReceiptDTO | null {
    const pending = this.pendingOrders.get(orderId);
    if (!pending) return null;

    const approvedReceipt: TransactionReceiptDTO = {
      ...pending,
      status: "approved",
    };

    this.pendingOrders.delete(orderId);
    return approvedReceipt;
  }

  public failOrder(orderId: string): TransactionReceiptDTO | null {
    const pending = this.pendingOrders.get(orderId);
    if (!pending) return null;

    const failedReceipt: TransactionReceiptDTO = {
      ...pending,
      status: "failed",
    };

    this.pendingOrders.delete(orderId);
    return failedReceipt;
  }

  public getPendingOrders(): ReadonlyArray<TransactionReceiptDTO> {
    return Array.from(this.pendingOrders.values());
  }

  public clear(): void {
    this.pendingOrders.clear();
  }
}