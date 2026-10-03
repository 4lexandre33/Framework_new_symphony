import type { TransactionReceiptDTO } from "../../contracts/monetization/types";

export class InventoryReceiptValidator {
  public validateReceipt(receipt: TransactionReceiptDTO): boolean {
    if (!receipt.orderId || !receipt.transId || !receipt.signature) {
      return false;
    }

    if (receipt.amountCents <= 0) {
      return false;
    }

    if (receipt.status !== "approved") {
      return false;
    }

    const expectedSignature = this.calculateSignature(
      receipt.orderId,
      receipt.transId,
      receipt.steamId,
      receipt.sku,
      receipt.amountCents
    );

    return receipt.signature === expectedSignature;
  }

  public calculateSignature(
    orderId: string,
    transId: string,
    steamId: string,
    sku: string,
    amountCents: number
  ): string {
    const raw = `${orderId}:${transId}:${steamId}:${sku}:${amountCents}:STEAM_SECRET_SALT`;
    let hash = 5381;
    for (let i = 0; i < raw.length; i++) {
      const char = raw.charCodeAt(i);
      hash = (hash << 5) + hash + char;
      hash |= 0;
    }
    return `sig_${Math.abs(hash).toString(16)}`;
  }
}