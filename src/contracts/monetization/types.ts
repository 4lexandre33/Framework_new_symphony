import { defineEvent, defineCommand } from "@core";

export type MonetizationItemType = "consumable" | "durable" | "currency" | "bundle";

export interface MonetizationItemDTO {
  readonly sku: string;
  readonly title: string;
  readonly description: string;
  readonly priceBaseCents: number;
  readonly currencyCode: string;
  readonly itemType: MonetizationItemType;
  readonly grantedCurrencyAmount?: number;
  /** Moeda creditada por `grantedCurrencyAmount` (padrão `"gold"`). */
  readonly grantedCurrencyId?: string;
  readonly grantedItemSkus?: ReadonlyArray<string>;
  /** Definição no Steam Inventory (compra via checkout da Steam e mapeamento do inventário). */
  readonly steamItemDefId?: number;
  readonly iconUrl?: string;
  readonly isDiscounted?: boolean;
  readonly discountPercentage?: number;
}

export type TransactionStatus = "pending" | "approved" | "failed" | "refunded";

// ── COMPRA REAL PLUGÁVEL (G119) ─────────────────────────────────────────────

export interface PurchaseInitRequest {
  readonly sku: string;
  readonly item: MonetizationItemDTO;
  /** SteamID do jogador (null sem Steam). */
  readonly steamId: string | null;
}

export interface PurchaseInitResult {
  /** Id da ordem criada pelo SERVIDOR (ex.: ISteamMicroTxn/InitTxn). */
  readonly orderId: string;
  readonly transId?: string;
  readonly amountCents: number;
}

/** O que o servidor autorizou entregar (autoridade sobre o catálogo local). */
export interface PurchaseGrants {
  readonly currencies?: Readonly<Record<string, number>>;
  readonly items?: Readonly<Record<string, number>>;
}

export interface VerifiedPurchase {
  readonly status: TransactionStatus;
  /** Recibo verificado pelo servidor (FinalizeTxn/QueryTxn). */
  readonly receipt: TransactionReceiptDTO;
  readonly grants?: PurchaseGrants;
  readonly reason?: string;
}

/**
 * Provedor de compra com dinheiro real. A engine NÃO fabrica compras: sem
 * provedor, `initPurchase` falha com motivo `unsupported`. Implemente-o com o
 * SEU servidor (que guarda a publisher key e chama ISteamMicroTxn); o cliente
 * só recebe a resposta do usuário (`game.steam.microtxn-authorization`).
 */
export interface PurchaseProvider {
  readonly id: string;
  initPurchase(request: PurchaseInitRequest): Promise<PurchaseInitResult>;
  finalizePurchase(orderId: string): Promise<VerifiedPurchase>;
  /** Verificação server-side de um recibo (opcional). */
  verifyReceipt?(receipt: TransactionReceiptDTO): Promise<boolean>;
}

export interface RegisterCatalogOptions {
  /** Remove o catálogo atual (inclusive os SKUs de exemplo, se semeados) antes. */
  readonly replace?: boolean;
}

/**
 * Estado persistido da carteira (G135). ATENÇÃO: fica no cliente e pode ser
 * editado pelo jogador; moeda comprada com dinheiro real deve ter o SERVIDOR
 * como fonte da verdade (o `PurchaseProvider` reconcilia).
 */
export interface PersistedWalletState {
  readonly version: 1;
  readonly currencies: Readonly<Record<string, number>>;
  readonly entitlements: Readonly<Record<string, number>>;
}

/** Onde a carteira é salva/restaurada (o plugin cria uma sobre o `game.storage`). */
export interface WalletPersistence {
  /** null = nada salvo ainda. Rejeitar = falha de leitura (autosave fica desligado). */
  load(): Promise<unknown>;
  save(state: PersistedWalletState): Promise<void>;
}

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

export interface ItemGrantedPayload {
  readonly sku: string;
  readonly quantity: number;
  readonly orderId: string;
}

/** Item (não moeda) entregue por uma compra verificada. */
export const ItemGrantedEvent = defineEvent<
  "game.monetization.item-granted",
  ItemGrantedPayload
>("game.monetization.item-granted");

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