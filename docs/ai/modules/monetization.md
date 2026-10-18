# monetization — Microtransações Steam & Steam Inventory Service
capability: game.monetization@1.0.0 | category: functional | engine plugin id: game.monetization
consumes: SteamToken
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
  creditCurrency(currencyId: string, amount: number, reason?: string): number; // Credita `amount` (inteiro seguro > 0).
  debitCurrency(currencyId: string, amount: number, reason?: string): boolean; // Debita `amount` (inteiro seguro > 0); `false` se inválido ou sem saldo.
  initPurchase(sku: string): Promise<TransactionReceiptDTO | null>; // Inicia compra com dinheiro real pelo `PurchaseProvider` (servidor).
  finalizePurchase(orderId: string): Promise<boolean>; // Finaliza pelo provedor; credita só o que o recibo verificado concede.
  getSteamInventory(): ReadonlyArray<SteamInventoryItemDTO>;
  fetchSteamInventory(): Promise<ReadonlyArray<SteamInventoryItemDTO>>;
  consumeInventoryItem(itemId: string, quantity?: number): Promise<boolean>;
  validateReceipt(receipt: TransactionReceiptDTO): boolean; // `true` só para recibo aprovado pelo provedor nesta sessão (sem validação local por sal).
  clear(): void; // Zera carteira, ordens pendentes, entitlements e inventário em cache.
  registerCatalogItem(item: MonetizationItemDTO): void; // Registra/atualiza um item do catálogo do jogo (valida; lança se inválido).
  registerCatalog(items: ReadonlyArray<MonetizationItemDTO>, options?: RegisterCatalogOptions): void; // Registra vários itens (tudo ou nada); `replace` remove os atuais antes.
  removeCatalogItem(sku: string): boolean;
  setPurchaseProvider(provider: PurchaseProvider | null): void; // Define (ou remove com `null`) o provedor de compra real.
  isPurchaseSupported(): boolean; // `true` se há provedor de compra configurado.
  verifyReceipt(receipt: TransactionReceiptDTO): Promise<boolean>; // Verificação de recibo pelo provedor (`false` sem provedor).
  startInventoryPurchase(sku: string, quantity?: number): Promise<boolean>; // Abre o checkout da Steam para um item com `steamItemDefId` (Steam Inventory).
  getEntitlements(): Readonly<Record<string, number>>; // Itens (não moeda) concedidos por compras verificadas: sku → quantidade.
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
  readonly grantedCurrencyId?: string; // Moeda creditada por `grantedCurrencyAmount` (padrão `"gold"`).
  readonly grantedItemSkus?: ReadonlyArray<string>;
  readonly steamItemDefId?: number; // Definição no Steam Inventory (compra via checkout da Steam e mapeamento do inventário).
  readonly iconUrl?: string;
  readonly isDiscounted?: boolean;
  readonly discountPercentage?: number;
}
export type TransactionStatus = "pending" | "approved" | "failed" | "refunded";
interface PurchaseInitRequest {
  readonly sku: string;
  readonly item: MonetizationItemDTO;
  readonly steamId: string | null; // SteamID do jogador (null sem Steam).
}
interface PurchaseInitResult {
  readonly orderId: string; // Id da ordem criada pelo SERVIDOR (ex.: ISteamMicroTxn/InitTxn).
  readonly transId?: string;
  readonly amountCents: number;
}
interface PurchaseGrants { // O que o servidor autorizou entregar (autoridade sobre o catálogo local).
  readonly currencies?: Readonly<Record<string, number>>;
  readonly items?: Readonly<Record<string, number>>;
}
interface VerifiedPurchase {
  readonly status: TransactionStatus;
  readonly receipt: TransactionReceiptDTO; // Recibo verificado pelo servidor (FinalizeTxn/QueryTxn).
  readonly grants?: PurchaseGrants;
  readonly reason?: string;
}
interface PurchaseProvider { // Provedor de compra com dinheiro real.
  readonly id: string;
  initPurchase(request: PurchaseInitRequest): Promise<PurchaseInitResult>;
  finalizePurchase(orderId: string): Promise<VerifiedPurchase>;
  verifyReceipt?(receipt: TransactionReceiptDTO): Promise<boolean>; // Verificação server-side de um recibo (opcional).
}
interface RegisterCatalogOptions {
  readonly replace?: boolean; // Remove o catálogo atual (inclusive os SKUs de exemplo) antes.
}
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
interface ItemGrantedPayload {
  readonly sku: string;
  readonly quantity: number;
  readonly orderId: string;
}
event ItemGrantedEvent = "game.monetization.item-granted" payload ItemGrantedPayload // Item (não moeda) entregue por uma compra verificada.
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
- Catálogo: começa com 2 SKUs de exemplo; registre o do jogo com `registerCatalog(itens, { replace: true })` ou `registerCatalogItem` (valida; lança se inválido).
- Carteira (`creditCurrency`/`debitCurrency`/`getWalletBalance`) em memória, funciona offline. Valores precisam ser inteiros seguros > 0 (inválido: `debitCurrency` false, crédito ignorado); `debitCurrency` false sem saldo. NÃO persiste: salve o saldo no `game.storage` e recredite no boot.
- Dinheiro real só com um `PurchaseProvider` do SERVIDOR do jogo (`setPurchaseProvider`): sem ele `isPurchaseSupported()` é false, `initPurchase` resolve `null` (+ `purchase-failed` "unsupported") e nada é creditado. Com ele, só o que o recibo verificado concede é entregue (`wallet-updated`, `item-granted`, `getEntitlements()`); `validateReceipt` só aceita recibos aprovados nesta sessão.
- Steam Inventory: itens com `steamItemDefId`; `fetchSteamInventory`, `consumeInventoryItem`, `startInventoryPurchase` (checkout da Steam). Sem Steam: `[]`/`false`. Não verificado com Steam real (GAPS NV).
- `clear()` zera carteira/ordens/inventário em cache (o catálogo fica).
