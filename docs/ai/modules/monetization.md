# monetization — Microtransações Steam & Steam Inventory Service
capability: game.monetization@1.0.0 | category: functional | engine plugin id: game.monetization
use (from src/projects/<jogo>/**):
  import { MonetizationToken } from "../../tokens/monetization";
  // acesso: const api = ctx.caps.require(Token)  (declare o token em capabilities.consumes + permissions.capabilities)

## token src/tokens/monetization.ts
```ts
interface MonetizationApi {
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
capability MonetizationToken = "game.monetization"@1.0.0 api MonetizationApi
```
## contract src/contracts/monetization/types.ts
```ts
export type MonetizationItemType = "consumable" | "durable" | "currency" | "bundle";
interface MonetizationItemDTO {
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
interface TransactionReceiptDTO {
  readonly orderId: string;
  readonly transId: string;
  readonly steamId: string;
  readonly sku: string;
  readonly amountCents: number;
  readonly status: TransactionStatus;
  readonly timestamp: number;
  readonly signature: string;
}
interface VirtualWalletDTO {
  readonly playerId: string;
  readonly currencies: Readonly<Record<string, number>>;
  readonly pendingTransactionsCount: number;
}
interface SteamInventoryItemDTO {
  readonly itemId: string;
  readonly definitionId: number;
  readonly sku: string;
  readonly quantity: number;
  readonly acquiredTimestamp: number;
  readonly isTradable: boolean;
  readonly isMarketable: boolean;
  readonly customData?: Readonly<Record<string, unknown>>;
}
interface PurchaseInitiatedPayload {
  readonly orderId: string;
  readonly sku: string;
  readonly amountCents: number;
}
event PurchaseInitiatedEvent = "game.monetization.purchase-initiated" payload PurchaseInitiatedPayload
interface PurchaseCompletedPayload {
  readonly orderId: string;
  readonly transId: string;
  readonly sku: string;
  readonly receipt: TransactionReceiptDTO;
}
event PurchaseCompletedEvent = "game.monetization.purchase-completed" payload PurchaseCompletedPayload
interface PurchaseFailedPayload {
  readonly orderId: string;
  readonly sku: string;
  readonly reason: string;
}
event PurchaseFailedEvent = "game.monetization.purchase-failed" payload PurchaseFailedPayload
interface WalletUpdatedPayload {
  readonly currencyId: string;
  readonly newBalance: number;
  readonly delta: number;
  readonly reason: string;
}
event WalletUpdatedEvent = "game.monetization.wallet-updated" payload WalletUpdatedPayload
interface InventoryRefreshedPayload {
  readonly itemCount: number;
  readonly timestamp: number;
}
event InventoryRefreshedEvent = "game.monetization.inventory-refreshed" payload InventoryRefreshedPayload
interface InitPurchasePayload {
  readonly sku: string;
}
command InitPurchaseCommand = "game.monetization.init-purchase" request InitPurchasePayload
interface FinalizePurchasePayload {
  readonly orderId: string;
}
command FinalizePurchaseCommand = "game.monetization.finalize-purchase" request FinalizePurchasePayload
interface ConsumeItemPayload {
  readonly itemId: string;
  readonly quantity?: number;
}
command ConsumeItemCommand = "game.monetization.consume-item" request ConsumeItemPayload
interface FetchInventoryPayload {
  readonly forceRefresh?: boolean;
}
command FetchInventoryCommand = "game.monetization.fetch-inventory" request FetchInventoryPayload
```
## notas verificadas (comportamento)
- `getCatalog()` devolve 2 SKUs fixos (`gold_pack_small`, `gold_pack_large`); não há API pública para registrar itens. Itens/cosméticos do jogo: mantenha o catálogo no jogo.
- Carteira (`creditCurrency`/`debitCurrency`/`getWalletBalance`) é em memória e funciona offline; `debitCurrency` retorna false sem saldo. Não persiste sozinha: salve o saldo via `game.storage`.
- `initPurchase` offline cria recibo falso pendente (não é compra real); inventário Steam devolve `[]`/false sem Tauri. Não use compra real em testes.
