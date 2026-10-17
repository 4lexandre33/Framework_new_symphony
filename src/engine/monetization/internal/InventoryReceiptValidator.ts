import type { TransactionReceiptDTO } from "../../../contracts/monetization/types";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/u;

function fingerprint(receipt: TransactionReceiptDTO): string {
  return JSON.stringify([
    receipt.orderId,
    receipt.transId,
    receipt.steamId,
    receipt.sku,
    receipt.amountCents,
    receipt.status,
    receipt.signature,
  ]);
}

/**
 * G119: o cliente NÃO valida recibos por conta própria (nada de sal
 * embutido). Um recibo só é "válido" se foi devolvido como aprovado pelo
 * `PurchaseProvider` (servidor) nesta sessão; aqui só registramos isso e
 * checamos a forma.
 */
export class InventoryReceiptValidator {
  private readonly verified = new Map<string, string>();

  public isWellFormed(receipt: unknown): receipt is TransactionReceiptDTO {
    if (typeof receipt !== "object" || receipt === null) return false;
    const value = receipt as Partial<TransactionReceiptDTO>;
    return (
      typeof value.orderId === "string" &&
      IDENTIFIER_PATTERN.test(value.orderId) &&
      typeof value.transId === "string" &&
      value.transId.length <= 128 &&
      typeof value.steamId === "string" &&
      value.steamId.length <= 32 &&
      typeof value.sku === "string" &&
      IDENTIFIER_PATTERN.test(value.sku) &&
      typeof value.amountCents === "number" &&
      Number.isSafeInteger(value.amountCents) &&
      value.amountCents >= 0 &&
      (value.status === "pending" || value.status === "approved" || value.status === "failed" || value.status === "refunded") &&
      typeof value.timestamp === "number" &&
      Number.isFinite(value.timestamp) &&
      typeof value.signature === "string" &&
      value.signature.length <= 4096
    );
  }

  /** Registra um recibo aprovado pelo provedor/servidor. */
  public markVerified(receipt: TransactionReceiptDTO): void {
    if (this.isWellFormed(receipt) && receipt.status === "approved") {
      this.verified.set(receipt.orderId, fingerprint(receipt));
    }
  }

  /** `true` só para recibo idêntico a um aprovado pelo provedor nesta sessão. */
  public validateReceipt(receipt: TransactionReceiptDTO): boolean {
    if (!this.isWellFormed(receipt) || receipt.status !== "approved") return false;
    return this.verified.get(receipt.orderId) === fingerprint(receipt);
  }

  public clear(): void {
    this.verified.clear();
  }
}
