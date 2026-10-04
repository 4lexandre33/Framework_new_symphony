import { defineCapability } from "@core";
import type {
  MonetizationItemDTO,
  TransactionReceiptDTO,
  SteamInventoryItemDTO,
  VirtualWalletDTO,
} from "../contracts/monetization/types";

export interface MonetizationApi {
  getCatalog(): ReadonlyArray<MonetizationItemDTO>;
  getItemBySku(sku: string): MonetizationItemDTO | null;
  getWalletBalance(currencyId: string): number;
  getWalletSnapshot(): VirtualWalletDTO;
  creditCurrency(currencyId: string, amount: number, reason?: string): number;
  debitCurrency(currencyId: string, amount: number, reason?: string): boolean;
  initPurchase(sku: string): Promise<TransactionReceiptDTO | null>;
  finalizePurchase(orderId: string): Promise<boolean>;
  getSteamInventory(): ReadonlyArray<SteamInventoryItemDTO>;
  fetchSteamInventory(): Promise<ReadonlyArray<SteamInventoryItemDTO>>;
  consumeInventoryItem(itemId: string, quantity?: number): Promise<boolean>;
  validateReceipt(receipt: TransactionReceiptDTO): boolean;
  clear(): void;
}

export const MonetizationToken = defineCapability<MonetizationApi>(
  "game.monetization",
  "1.0.0"
);