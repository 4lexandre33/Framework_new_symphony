import type { PluginContext } from "@core";
import { type MonetizationApi } from "../../../tokens/monetization";
import {
  ItemGrantedEvent,
  type MonetizationItemDTO,
  type PersistedWalletState,
  type PurchaseGrants,
  type PurchaseProvider,
  type RegisterCatalogOptions,
  type SteamInventoryItemDTO,
  type TransactionReceiptDTO,
  type VirtualWalletDTO,
  type WalletPersistence,
  type WalletPersistenceConfig,
} from "../../../contracts/monetization/types";
import { StoreCatalogRegistry, validateCatalogItem } from "./StoreCatalogRegistry";
import { InventoryReceiptValidator } from "./InventoryReceiptValidator";
import { VirtualCurrencyWallet, isValidAmount, isValidCurrencyId } from "./VirtualCurrencyWallet";
import { SteamMicroTxnBridge } from "./SteamMicroTxnBridge";
import { TauriMonetizationDriver } from "./TauriMonetizationDriver";

const DEFAULT_CURRENCY_ID = "gold";
const ORDER_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/u;

export interface MonetizationServiceOptions {
  readonly tauriDriver?: TauriMonetizationDriver;
  /**
   * Semeia 2 SKUs de EXEMPLO (`gold_pack_small`/`gold_pack_large`) para
   * demos. Padrão false (G135): o catálogo começa vazio e o jogo registra o seu.
   */
  readonly seedDefaultCatalog?: boolean;
  /**
   * Persistência da carteira (saldos + entitlements). Com isto a carteira é
   * restaurada no boot e salva a cada mudança (depois da restauração).
   */
  readonly walletPersistence?: WalletPersistence;
  /**
   * Fábrica usada por `enableWalletPersistence(config)` em runtime (o plugin
   * passa uma sobre o `game.storage`). Sem fábrica, o método resolve `false`.
   */
  readonly walletPersistenceFactory?: (config: WalletPersistenceConfig) => WalletPersistence | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class MonetizationService implements MonetizationApi {
  private readonly catalog = new StoreCatalogRegistry();
  private readonly validator = new InventoryReceiptValidator();
  private readonly wallet = new VirtualCurrencyWallet();
  private readonly bridge = new SteamMicroTxnBridge();
  private readonly tauriDriver: TauriMonetizationDriver;
  private readonly entitlements = new Map<string, number>();
  private readonly finalizing = new Set<string>();
  private cachedInventory: SteamInventoryItemDTO[] = [];
  private provider: PurchaseProvider | null = null;
  private steamIdResolver: (() => Promise<string | null>) | null = null;
  private persistence: WalletPersistence | null;
  private restorePromise: Promise<boolean> | null = null;
  private restored = false;
  private dirty = false;
  private saving: Promise<boolean> | null = null;
  private readonly persistenceFactory: ((config: WalletPersistenceConfig) => WalletPersistence | null) | null;

  public constructor(private readonly ctx: PluginContext, options: MonetizationServiceOptions = {}) {
    this.tauriDriver = options.tauriDriver ?? new TauriMonetizationDriver();
    if (options.seedDefaultCatalog === true) {
      this.seedDefaultCatalog();
    }
    this.persistenceFactory = options.walletPersistenceFactory ?? null;
    this.persistence = options.walletPersistence ?? null;
    if (this.persistence !== null) {
      void this.restoreWallet();
    }
  }

  // ── persistência da carteira (G135) ──────────────────────────────────────

  public isWalletPersistent(): boolean {
    return this.persistence !== null;
  }

  public async enableWalletPersistence(config: WalletPersistenceConfig = {}): Promise<boolean> {
    if (this.persistence !== null) return await this.restoreWallet();
    if (config === null || typeof config !== "object") return false;
    if (config.slotName !== undefined && (typeof config.slotName !== "string" || config.slotName.trim() === "")) {
      return false;
    }
    let created: WalletPersistence | null = null;
    try {
      created = this.persistenceFactory !== null ? this.persistenceFactory(config) : null;
    } catch (error: unknown) {
      console.warn("[Monetization] Não foi possível criar a persistência da carteira.", error);
      created = null;
    }
    if (created === null) return false;
    this.persistence = created;
    this.restorePromise = null;
    this.restored = false;
    // O que já está em memória (antes de ligar) entra no save depois da restauração.
    const snapshot = this.wallet.getSnapshot();
    this.dirty = Object.keys(snapshot.currencies).length > 0 || this.entitlements.size > 0;
    return await this.restoreWallet();
  }

  public seedSampleCatalog(): ReadonlyArray<string> {
    this.seedDefaultCatalog();
    return ["gold_pack_small", "gold_pack_large"];
  }

  public restoreWallet(): Promise<boolean> {
    if (this.restorePromise === null) {
      this.restorePromise = this.doRestore();
    }
    return this.restorePromise;
  }

  private async doRestore(): Promise<boolean> {
    const persistence = this.persistence;
    if (persistence === null) return false;

    let raw: unknown;
    try {
      raw = await persistence.load();
    } catch (error: unknown) {
      console.warn("[Monetization] Falha ao restaurar a carteira; autosave desligado para não sobrescrever o save.", error);
      return false;
    }
    if (this.persistence !== persistence) return false;

    if (raw !== null && raw !== undefined) {
      const state = raw as Partial<PersistedWalletState>;
      if (typeof state !== "object" || state.version !== 1) {
        console.warn("[Monetization] Carteira salva em formato desconhecido; ignorada (autosave desligado).");
        return false;
      }
      const applied = this.wallet.mergeRestored(
        typeof state.currencies === "object" && state.currencies !== null ? state.currencies : {},
      );
      if (typeof state.entitlements === "object" && state.entitlements !== null) {
        for (const [sku, quantity] of Object.entries(state.entitlements)) {
          if (!ORDER_ID_PATTERN.test(sku) || !isValidAmount(quantity)) continue;
          const next = (this.entitlements.get(sku) ?? 0) + quantity;
          if (Number.isSafeInteger(next)) this.entitlements.set(sku, next);
        }
      }
      for (const [currencyId, delta] of Object.entries(applied)) {
        this.ctx.events.emit("game.monetization.wallet-updated", {
          currencyId,
          newBalance: this.wallet.getBalance(currencyId),
          delta,
          reason: "restore",
        });
      }
    }

    this.restored = true;
    // Mudanças feitas antes da restauração terminar agora vão para o save.
    if (this.dirty) void this.flushSaves();
    return true;
  }

  public async saveWallet(): Promise<boolean> {
    if (this.persistence === null) return false;
    // Nunca grava por cima do save antes de tentar restaurá-lo.
    await this.restoreWallet();
    if (this.persistence === null) return false;
    this.dirty = true;
    return await this.flushSaves();
  }

  private exportWalletState(): PersistedWalletState {
    return {
      version: 1,
      currencies: this.wallet.getSnapshot().currencies,
      entitlements: Object.fromEntries(this.entitlements),
    };
  }

  /** Marca mudança; autosave só depois de restaurar (sem timers: coalesce). */
  private markWalletChanged(): void {
    if (this.persistence === null) return;
    this.dirty = true;
    if (this.restored) void this.flushSaves();
  }

  /** Grava até não haver mudança pendente; saves concorrentes se juntam. */
  private flushSaves(): Promise<boolean> {
    if (this.saving !== null) return this.saving;
    const run = (async (): Promise<boolean> => {
      let ok = true;
      while (this.dirty && this.persistence !== null) {
        this.dirty = false;
        try {
          await this.persistence.save(this.exportWalletState());
          ok = true;
        } catch (error: unknown) {
          ok = false;
          console.warn("[Monetization] Falha ao salvar a carteira.", error);
          break;
        }
      }
      return ok;
    })();
    this.saving = run;
    void run.finally(() => {
      if (this.saving !== run) return;
      this.saving = null;
      // Mudança chegou entre o fim do laço e este ponto.
      if (this.dirty && this.restored) void this.flushSaves();
    });
    return run;
  }

  /** Desliga a persistência (dispose): nada mais é salvo, nem o `clear()`. */
  public detachWalletPersistence(): void {
    this.persistence = null;
    this.dirty = false;
  }

  // ── catálogo (G13) ────────────────────────────────────────────────────────

  public getCatalog(): ReadonlyArray<MonetizationItemDTO> {
    return this.catalog.getCatalog();
  }

  public getItemBySku(sku: string): MonetizationItemDTO | null {
    return this.catalog.getItem(sku);
  }

  public registerCatalogItem(item: MonetizationItemDTO): void {
    this.catalog.registerItem(item);
  }

  public registerCatalog(items: ReadonlyArray<MonetizationItemDTO>, options: RegisterCatalogOptions = {}): void {
    if (!Array.isArray(items)) throw new Error("registerCatalog espera um array.");
    // valida tudo antes de alterar (tudo ou nada)
    const valid = items.map((item) => validateCatalogItem(item));
    const skus = new Set<string>();
    for (const item of valid) {
      if (skus.has(item.sku)) throw new Error(`SKU duplicado no catálogo: ${item.sku}`);
      skus.add(item.sku);
    }
    if (options.replace === true) this.catalog.clear();
    for (const item of valid) this.catalog.registerItem(item);
  }

  public removeCatalogItem(sku: string): boolean {
    return typeof sku === "string" && this.catalog.removeItem(sku);
  }

  // ── carteira (G120) ───────────────────────────────────────────────────────

  public getWalletBalance(currencyId: string): number {
    return this.wallet.getBalance(currencyId);
  }

  public getWalletSnapshot(): VirtualWalletDTO {
    return this.wallet.getSnapshot(this.bridge.getPendingOrders().length);
  }

  public creditCurrency(currencyId: string, amount: number, reason = "credit"): number {
    if (!this.wallet.tryCredit(currencyId, amount, reason)) {
      // no-op (entrada inválida/estouro): sem evento enganoso.
      return isValidCurrencyId(currencyId) ? this.wallet.getBalance(currencyId) : 0;
    }
    const newBalance = this.wallet.getBalance(currencyId);
    this.markWalletChanged();
    this.ctx.events.emit("game.monetization.wallet-updated", {
      currencyId,
      newBalance,
      delta: amount,
      reason,
    });
    return newBalance;
  }

  public debitCurrency(currencyId: string, amount: number, reason = "debit"): boolean {
    const success = this.wallet.debit(currencyId, amount, reason);
    if (success) {
      this.markWalletChanged();
      this.ctx.events.emit("game.monetization.wallet-updated", {
        currencyId,
        newBalance: this.wallet.getBalance(currencyId),
        delta: -amount,
        reason,
      });
    }
    return success;
  }

  // ── compra real plugável (G119) ───────────────────────────────────────────

  public setPurchaseProvider(provider: PurchaseProvider | null): void {
    if (
      provider !== null &&
      (typeof provider !== "object" ||
        typeof provider.initPurchase !== "function" ||
        typeof provider.finalizePurchase !== "function")
    ) {
      throw new Error("PurchaseProvider inválido: initPurchase/finalizePurchase são obrigatórios.");
    }
    this.provider = provider;
  }

  public isPurchaseSupported(): boolean {
    return this.provider !== null;
  }

  /** Fonte do SteamID do jogador (o plugin liga ao `game.steam`). */
  public setSteamIdResolver(resolver: (() => Promise<string | null>) | null): void {
    this.steamIdResolver = resolver;
  }

  private emitFailed(orderId: string, sku: string, reason: string): void {
    this.ctx.events.emit("game.monetization.purchase-failed", { orderId, sku, reason });
  }

  public async initPurchase(sku: string): Promise<TransactionReceiptDTO | null> {
    const item = this.catalog.getItem(sku);
    if (!item) {
      this.emitFailed("none", String(sku), "Item não encontrado no catálogo.");
      return null;
    }

    const provider = this.provider;
    if (!provider) {
      // Nenhuma compra fabricada: sem servidor não há compra real.
      this.emitFailed("none", item.sku, "unsupported");
      return null;
    }

    let steamId: string | null = null;
    try {
      steamId = this.steamIdResolver ? await this.steamIdResolver() : null;
    } catch {
      steamId = null;
    }

    let result: Awaited<ReturnType<PurchaseProvider["initPurchase"]>>;
    try {
      result = await provider.initPurchase({ sku: item.sku, item, steamId });
    } catch (error: unknown) {
      this.emitFailed("none", item.sku, `provider_error: ${errorMessage(error)}`);
      return null;
    }

    if (
      !result ||
      typeof result.orderId !== "string" ||
      !ORDER_ID_PATTERN.test(result.orderId) ||
      !Number.isSafeInteger(result.amountCents) ||
      result.amountCents < 0
    ) {
      this.emitFailed("none", item.sku, "provider_invalid_response");
      return null;
    }

    const receipt: TransactionReceiptDTO = {
      orderId: result.orderId,
      transId: typeof result.transId === "string" ? result.transId : "",
      steamId: steamId ?? "",
      sku: item.sku,
      amountCents: result.amountCents,
      status: "pending",
      timestamp: Date.now(),
      signature: "",
    };

    if (!this.bridge.addPending(receipt)) {
      this.emitFailed(receipt.orderId, item.sku, "too_many_pending_orders");
      return null;
    }

    this.ctx.events.emit("game.monetization.purchase-initiated", {
      orderId: receipt.orderId,
      sku: item.sku,
      amountCents: receipt.amountCents,
    });

    return receipt;
  }

  /**
   * Resposta do usuário ao diálogo da Steam (`game.steam.microtxn-authorization`):
   * autorizado → finaliza pelo provedor; recusado → falha.
   */
  public async handleMicroTxnAuthorization(orderId: string, authorized: boolean): Promise<boolean> {
    const pending = this.bridge.getPending(orderId);
    if (!pending) return false;
    if (!authorized) {
      this.bridge.take(orderId);
      this.emitFailed(orderId, pending.sku, "user_cancelled");
      return false;
    }
    return this.finalizePurchase(orderId);
  }

  public async finalizePurchase(orderId: string): Promise<boolean> {
    const pending = typeof orderId === "string" ? this.bridge.getPending(orderId) : null;
    if (!pending) {
      this.emitFailed(String(orderId), "unknown", "Ordem pendente não encontrada.");
      return false;
    }

    const provider = this.provider;
    if (!provider) {
      this.emitFailed(orderId, pending.sku, "unsupported");
      return false;
    }

    if (this.finalizing.has(orderId)) return false;
    this.finalizing.add(orderId);

    try {
      let verified: Awaited<ReturnType<PurchaseProvider["finalizePurchase"]>>;
      try {
        verified = await provider.finalizePurchase(orderId);
      } catch (error: unknown) {
        // ordem continua pendente: pode ser finalizada de novo
        this.emitFailed(orderId, pending.sku, `provider_error: ${errorMessage(error)}`);
        return false;
      }

      const receipt = verified?.receipt;
      if (
        !verified ||
        !this.validator.isWellFormed(receipt) ||
        receipt.orderId !== orderId ||
        receipt.sku !== pending.sku
      ) {
        this.emitFailed(orderId, pending.sku, "provider_invalid_receipt");
        return false;
      }

      if (verified.status === "pending" || receipt.status === "pending") {
        return false; // ainda aguardando o servidor
      }

      this.bridge.take(orderId);

      if (verified.status !== "approved" || receipt.status !== "approved") {
        this.emitFailed(orderId, pending.sku, verified.reason ?? receipt.status);
        return false;
      }

      this.validator.markVerified(receipt);
      this.applyGrants(orderId, pending.sku, verified.grants);

      this.ctx.events.emit("game.monetization.purchase-completed", {
        orderId,
        transId: receipt.transId,
        sku: receipt.sku,
        receipt,
      });

      return true;
    } finally {
      this.finalizing.delete(orderId);
    }
  }

  /** Concede EXATAMENTE o que o servidor autorizou, ou o que o item do catálogo concede. */
  private applyGrants(orderId: string, sku: string, grants: PurchaseGrants | undefined): void {
    const item = this.catalog.getItem(sku);
    const currencies: Record<string, number> = {};
    const items: Record<string, number> = {};

    if (grants) {
      for (const [currencyId, amount] of Object.entries(grants.currencies ?? {})) {
        if (isValidCurrencyId(currencyId) && isValidAmount(amount)) currencies[currencyId] = amount;
      }
      for (const [grantedSku, quantity] of Object.entries(grants.items ?? {})) {
        if (ORDER_ID_PATTERN.test(grantedSku) && isValidAmount(quantity)) items[grantedSku] = quantity;
      }
    } else if (item) {
      if (item.grantedCurrencyAmount !== undefined && isValidAmount(item.grantedCurrencyAmount)) {
        currencies[item.grantedCurrencyId ?? DEFAULT_CURRENCY_ID] = item.grantedCurrencyAmount;
      }
      for (const grantedSku of item.grantedItemSkus ?? []) {
        items[grantedSku] = (items[grantedSku] ?? 0) + 1;
      }
      if (item.itemType === "durable" || item.itemType === "consumable") {
        items[item.sku] = (items[item.sku] ?? 0) + 1;
      }
    }

    for (const [currencyId, amount] of Object.entries(currencies)) {
      this.creditCurrency(currencyId, amount, `purchase_${orderId}`);
    }
    for (const [grantedSku, quantity] of Object.entries(items)) {
      const next = (this.entitlements.get(grantedSku) ?? 0) + quantity;
      if (!Number.isSafeInteger(next)) continue;
      this.entitlements.set(grantedSku, next);
      this.markWalletChanged();
      this.ctx.events.emit(ItemGrantedEvent.type, { sku: grantedSku, quantity, orderId });
    }
  }

  public getEntitlements(): Readonly<Record<string, number>> {
    return Object.fromEntries(this.entitlements);
  }

  public validateReceipt(receipt: TransactionReceiptDTO): boolean {
    return this.validator.validateReceipt(receipt);
  }

  public async verifyReceipt(receipt: TransactionReceiptDTO): Promise<boolean> {
    if (!this.validator.isWellFormed(receipt)) return false;
    const verify = this.provider?.verifyReceipt;
    if (!verify) return false;
    try {
      const ok = (await verify.call(this.provider, receipt)) === true;
      if (ok) this.validator.markVerified(receipt);
      return ok;
    } catch {
      return false;
    }
  }

  // ── Steam Inventory ──────────────────────────────────────────────────────

  public async startInventoryPurchase(sku: string, quantity = 1): Promise<boolean> {
    const item = this.catalog.getItem(sku);
    if (!item || item.steamItemDefId === undefined) {
      this.emitFailed("none", String(sku), "sku sem steamItemDefId");
      return false;
    }
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 100) return false;
    const started = await this.tauriDriver.startInventoryPurchase(item.steamItemDefId, quantity);
    if (!started) this.emitFailed("none", item.sku, "steam_inventory_unavailable");
    return started;
  }

  public getSteamInventory(): ReadonlyArray<SteamInventoryItemDTO> {
    return this.cachedInventory;
  }

  public async fetchSteamInventory(): Promise<ReadonlyArray<SteamInventoryItemDTO>> {
    const items = await this.tauriDriver.fetchSteamInventory();
    this.cachedInventory = items.map((entry) => {
      const mapped = this.catalog.getItemBySteamDef(entry.definitionId);
      return mapped ? { ...entry, sku: mapped.sku } : { ...entry };
    });
    this.ctx.events.emit("game.monetization.inventory-refreshed", {
      itemCount: this.cachedInventory.length,
      timestamp: Date.now(),
    });
    return this.cachedInventory;
  }

  public async consumeInventoryItem(itemId: string, quantity = 1): Promise<boolean> {
    if (!Number.isSafeInteger(quantity) || quantity <= 0) return false;
    const success = await this.tauriDriver.consumeSteamItem(itemId, quantity);
    if (success) {
      await this.fetchSteamInventory();
    }
    return success;
  }

  /**
   * Zera o estado em memória. NÃO grava por si só (o save persistido fica);
   * a próxima mudança da carteira, ou `saveWallet()`, grava o estado novo.
   */
  public clear(): void {
    this.dirty = false;
    this.wallet.clear();
    this.bridge.clear();
    this.validator.clear();
    this.entitlements.clear();
    this.finalizing.clear();
    this.cachedInventory = [];
  }

  private seedDefaultCatalog(): void {
    this.catalog.registerItem({
      sku: "gold_pack_small",
      title: "Saco de Ouro (100)",
      description: "100 Moedas de Ouro",
      priceBaseCents: 199,
      currencyCode: "BRL",
      itemType: "currency",
      grantedCurrencyAmount: 100,
    });

    this.catalog.registerItem({
      sku: "gold_pack_large",
      title: "Baú de Ouro (1000)",
      description: "1000 Moedas de Ouro com 20% Bônus",
      priceBaseCents: 1499,
      currencyCode: "BRL",
      itemType: "currency",
      grantedCurrencyAmount: 1200,
      isDiscounted: true,
      discountPercentage: 20,
    });
  }
}
