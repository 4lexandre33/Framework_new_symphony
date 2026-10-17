import { defineCapability } from "@core";
import type {
  MonetizationItemDTO,
  PurchaseProvider,
  RegisterCatalogOptions,
  TransactionReceiptDTO,
  SteamInventoryItemDTO,
  VirtualWalletDTO,
} from "../contracts/monetization/types";

export interface MonetizationApi {
  getCatalog(): ReadonlyArray<MonetizationItemDTO>;
  getItemBySku(sku: string): MonetizationItemDTO | null;
  getWalletBalance(currencyId: string): number;
  getWalletSnapshot(): VirtualWalletDTO;
  /**
   * Credita `amount` (inteiro seguro > 0). Entrada inválida não altera o
   * saldo nem emite evento; devolve o saldo atual.
   */
  creditCurrency(currencyId: string, amount: number, reason?: string): number;
  /** Debita `amount` (inteiro seguro > 0); `false` se inválido ou sem saldo. */
  debitCurrency(currencyId: string, amount: number, reason?: string): boolean;
  /**
   * Inicia compra com dinheiro real pelo `PurchaseProvider` (servidor). Sem
   * provedor resolve `null` e emite `purchase-failed` com motivo `unsupported`.
   */
  initPurchase(sku: string): Promise<TransactionReceiptDTO | null>;
  /** Finaliza pelo provedor; credita só o que o recibo verificado concede. */
  finalizePurchase(orderId: string): Promise<boolean>;
  getSteamInventory(): ReadonlyArray<SteamInventoryItemDTO>;
  fetchSteamInventory(): Promise<ReadonlyArray<SteamInventoryItemDTO>>;
  consumeInventoryItem(itemId: string, quantity?: number): Promise<boolean>;
  /** `true` só para recibo aprovado pelo provedor nesta sessão (sem validação local por sal). */
  validateReceipt(receipt: TransactionReceiptDTO): boolean;
  /**
   * Zera carteira, ordens pendentes, entitlements e inventário em cache.
   * O catálogo e o provedor permanecem (módulo continua utilizável).
   */
  clear(): void;

  /** Registra/atualiza um item do catálogo do jogo (valida; lança se inválido). */
  registerCatalogItem(item: MonetizationItemDTO): void;
  /** Registra vários itens (tudo ou nada); `replace` remove os atuais antes. */
  registerCatalog(items: ReadonlyArray<MonetizationItemDTO>, options?: RegisterCatalogOptions): void;
  removeCatalogItem(sku: string): boolean;
  /** Define (ou remove com `null`) o provedor de compra real. */
  setPurchaseProvider(provider: PurchaseProvider | null): void;
  /** `true` se há provedor de compra configurado. */
  isPurchaseSupported(): boolean;
  /** Verificação de recibo pelo provedor (`false` sem provedor). */
  verifyReceipt(receipt: TransactionReceiptDTO): Promise<boolean>;
  /**
   * Abre o checkout da Steam para um item com `steamItemDefId` (Steam
   * Inventory). Os itens chegam ao inventário; `false` sem Steam/Tauri.
   */
  startInventoryPurchase(sku: string, quantity?: number): Promise<boolean>;
  /** Itens (não moeda) concedidos por compras verificadas: sku → quantidade. */
  getEntitlements(): Readonly<Record<string, number>>;
}

export const MonetizationToken = defineCapability<MonetizationApi>(
  "game.monetization",
  "1.0.0"
);
