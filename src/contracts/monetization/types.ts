import { defineEvent, defineCommand } from "../../core/contracts";

export type MonetizationItemType = "consumable" | "durable" | "currency" | "bundle";

export interface MonetizationItemDTO {
  readonly sku: string;
  readonly title: string;
  readonly description: string;
  readonly priceBaseCents: number;
  readonly currencyCode: string;
  readonly itemType: MonetizationItemType;
  readonly grantedCurrencyAmount?: number;
  readonly grantedItemSkus?: ReadonlyArray<string>;
  readonly iconUrl?: string;
  readonly isDiscounted?: boolean;
  readonly discountPercentage?: number;
}

export type TransactionStatus = "pending" | "approved" | "failed" | "refunded";

export interface TransactionReceiptDTO {
  readonly orderId: string;
  readonly transId: string;
  readonly steamId: string;
  readonly sku: string;
  readonly amountCents: number;
  readonly status: TransactionStatus;
  readonly timestamp: number;
  readonly signature: string;
}

export interface VirtualWalletDTO {
  readonly playerId: string;
  readonly currencies: Readonly<Record<string, number>>;
  readonly pendingTransactionsCount: number;
}

export interface SteamInventoryItemDTO {
  readonly itemId: string;
  readonly definitionId: number;
  readonly sku: string;
  readonly quantity: number;
  readonly acquiredTimestamp: number;
  readonly isTradable: boolean;
  readonly isMarketable: boolean;
  readonly customData?: Readonly<Record<string, unknown>>;
}

// ── EVENTOS DE MONETIZAÇÃO ──────────────────────────────────────────────────

export interface PurchaseInitiatedPayload {
  readonly orderId: string;
  readonly sku: string;
  readonly amountCents: number;
}

export const PurchaseInitiatedEvent = defineEvent<
  "game.monetization.purchase-initiated",
  PurchaseInitiatedPayload
>("game.monetization.purchase-initiated");

export interface PurchaseCompletedPayload {
  readonly orderId: string;
  readonly transId: string;
  readonly sku: string;
  readonly receipt: TransactionReceiptDTO;
}

export const PurchaseCompletedEvent = defineEvent<
  "game.monetization.purchase-completed",
  PurchaseCompletedPayload
>("game.monetization.purchase-completed");

export interface PurchaseFailedPayload {
  readonly orderId: string;
  readonly sku: string;
  readonly reason: string;
}

export const PurchaseFailedEvent = defineEvent<
  "game.monetization.purchase-failed",
  PurchaseFailedPayload
>("game.monetization.purchase-failed");

export interface WalletUpdatedPayload {
  readonly currencyId: string;
  readonly newBalance: number;
  readonly delta: number;
  readonly reason: string;
}

export const WalletUpdatedEvent = defineEvent<
  "game.monetization.wallet-updated",
  WalletUpdatedPayload
>("game.monetization.wallet-updated");

export interface InventoryRefreshedPayload {
  readonly itemCount: number;
  readonly timestamp: number;
}

export const InventoryRefreshedEvent = defineEvent<
  "game.monetization.inventory-refreshed",
  InventoryRefreshedPayload
>("game.monetization.inventory-refreshed");

// ── COMANDOS DE MONETIZAÇÃO ─────────────────────────────────────────────────

export interface InitPurchasePayload {
  readonly sku: string;
}

export const InitPurchaseCommand = defineCommand<
  "game.monetization.init-purchase",
  InitPurchasePayload
>("game.monetization.init-purchase");

export interface FinalizePurchasePayload {
  readonly orderId: string;
}

export const FinalizePurchaseCommand = defineCommand<
  "game.monetization.finalize-purchase",
  FinalizePurchasePayload
>("game.monetization.finalize-purchase");

export interface ConsumeItemPayload {
  readonly itemId: string;
  readonly quantity?: number;
}

export const ConsumeItemCommand = defineCommand<
  "game.monetization.consume-item",
  ConsumeItemPayload
>("game.monetization.consume-item");

export interface FetchInventoryPayload {
  readonly forceRefresh?: boolean;
}

export const FetchInventoryCommand = defineCommand<
  "game.monetization.fetch-inventory",
  FetchInventoryPayload
>("game.monetization.fetch-inventory");