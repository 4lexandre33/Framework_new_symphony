import type { Plugin, PluginContext } from "../../core/contracts/plugin-context";
import { MonetizationToken, type MonetizationApi } from "../../tokens/monetization";
import { SteamToken } from "../../tokens/steam";
import { StorageToken } from "../../tokens/storage";
import { UIToken } from "../../tokens/ui";

import {
  PurchaseInitiatedEvent,
  PurchaseCompletedEvent,
  PurchaseFailedEvent,
  WalletUpdatedEvent,
  InventoryRefreshedEvent,
  InitPurchaseCommand,
  FinalizePurchaseCommand,
  ConsumeItemCommand,
  FetchInventoryCommand,
  type MonetizationItemDTO,
  type TransactionReceiptDTO,
  type SteamInventoryItemDTO,
  type VirtualWalletDTO,
} from "../../contracts/monetization/types";

import { StoreCatalogRegistry } from "../../engine/monetization/StoreCatalogRegistry";
import { InventoryReceiptValidator } from "../../engine/monetization/InventoryReceiptValidator";
import { VirtualCurrencyWallet } from "../../engine/monetization/VirtualCurrencyWallet";
import { SteamMicroTxnBridge } from "../../engine/monetization/SteamMicroTxnBridge";
import { TauriMonetizationDriver } from "../../engine/monetization/TauriMonetizationDriver";

export const monetizationManifest: Plugin["manifest"] = {
  id: "game.monetization",
  name: "Steam Microtransactions & Inventory Service Plugin",
  version: "1.0.0",
  kind: "preloaded",
  authority: "game",
  permissions: {
    capabilities: [MonetizationToken.id, SteamToken.id, StorageToken.id, UIToken.id],
    events: [
      "game.monetization.purchase-initiated",
      "game.monetization.purchase-completed",
      "game.monetization.purchase-failed",
      "game.monetization.wallet-updated",
      "game.monetization.inventory-refreshed",
    ],
  },
  capabilities: {
    provides: [
      {
        id: MonetizationToken.id,
        version: "1.0.0",
      },
    ],
  },
};

export class MonetizationService implements MonetizationApi {
  private readonly catalog = new StoreCatalogRegistry();
  private readonly validator = new InventoryReceiptValidator();
  private readonly wallet = new VirtualCurrencyWallet();
  private readonly bridge = new SteamMicroTxnBridge();
  private readonly tauriDriver = new TauriMonetizationDriver();
  private cachedInventory: SteamInventoryItemDTO[] = [];

  public constructor(private readonly ctx: PluginContext) {
    this.seedDefaultCatalog();
  }

  public getCatalog(): ReadonlyArray<MonetizationItemDTO> {
    return this.catalog.getCatalog();
  }

  public getItemBySku(sku: string): MonetizationItemDTO | null {
    return this.catalog.getItem(sku);
  }

  public getWalletBalance(currencyId: string): number {
    return this.wallet.getBalance(currencyId);
  }

  public getWalletSnapshot(): VirtualWalletDTO {
    return this.wallet.getSnapshot(this.bridge.getPendingOrders().length);
  }

  public creditCurrency(currencyId: string, amount: number, reason = "credit"): number {
    const newBal = this.wallet.credit(currencyId, amount, reason);
    this.ctx.events.emit("game.monetization.wallet-updated", {
      currencyId,
      newBalance: newBal,
      delta: amount,
      reason,
    });
    return newBal;
  }

  public debitCurrency(currencyId: string, amount: number, reason = "debit"): boolean {
    const success = this.wallet.debit(currencyId, amount, reason);
    if (success) {
      this.ctx.events.emit("game.monetization.wallet-updated", {
        currencyId,
        newBalance: this.wallet.getBalance(currencyId),
        delta: -amount,
        reason,
      });
    }
    return success;
  }

  public async initPurchase(sku: string): Promise<TransactionReceiptDTO | null> {
    const item = this.catalog.getItem(sku);
    if (!item) {
      this.ctx.events.emit("game.monetization.purchase-failed", {
        orderId: "none",
        sku,
        reason: "Item não encontrado no catálogo.",
      });
      return null;
    }

    const receipt = this.bridge.createOrder(sku, item, "76561198000000000");
    this.ctx.events.emit("game.monetization.purchase-initiated", {
      orderId: receipt.orderId,
      sku,
      amountCents: receipt.amountCents,
    });

    return receipt;
  }

  public async finalizePurchase(orderId: string): Promise<boolean> {
    const approved = this.bridge.confirmOrder(orderId);
    if (!approved) {
      this.ctx.events.emit("game.monetization.purchase-failed", {
        orderId,
        sku: "unknown",
        reason: "Ordem pendente não encontrada.",
      });
      return false;
    }

    const isValid = this.validator.validateReceipt(approved);
    if (!isValid) {
      this.ctx.events.emit("game.monetization.purchase-failed", {
        orderId,
        sku: approved.sku,
        reason: "Assinatura do recibo inválida.",
      });
      return false;
    }

    const item = this.catalog.getItem(approved.sku);
    if (item && item.itemType === "currency" && item.grantedCurrencyAmount) {
      this.creditCurrency("gold", item.grantedCurrencyAmount, `purchase_${orderId}`);
    }

    this.ctx.events.emit("game.monetization.purchase-completed", {
      orderId,
      transId: approved.transId,
      sku: approved.sku,
      receipt: approved,
    });

    return true;
  }

  public getSteamInventory(): ReadonlyArray<SteamInventoryItemDTO> {
    return this.cachedInventory;
  }

  public async fetchSteamInventory(): Promise<ReadonlyArray<SteamInventoryItemDTO>> {
    const items = await this.tauriDriver.fetchSteamInventory();
    this.cachedInventory = [...items];
    this.ctx.events.emit("game.monetization.inventory-refreshed", {
      itemCount: items.length,
      timestamp: Date.now(),
    });
    return this.cachedInventory;
  }

  public async consumeInventoryItem(itemId: string, quantity = 1): Promise<boolean> {
    const success = await this.tauriDriver.consumeSteamItem(itemId, quantity);
    if (success) {
      await this.fetchSteamInventory();
    }
    return success;
  }

  public validateReceipt(receipt: TransactionReceiptDTO): boolean {
    return this.validator.validateReceipt(receipt);
  }

  public clear(): void {
    this.catalog.clear();
    this.wallet.clear();
    this.bridge.clear();
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

export function createMonetizationPlugin(): Plugin {
  return {
    manifest: monetizationManifest,

    setup(ctx: PluginContext) {
      const service = new MonetizationService(ctx);

      ctx.caps.provide(MonetizationToken, service);

      ctx.events.define(PurchaseInitiatedEvent);
      ctx.events.define(PurchaseCompletedEvent);
      ctx.events.define(PurchaseFailedEvent);
      ctx.events.define(WalletUpdatedEvent);
      ctx.events.define(InventoryRefreshedEvent);

      ctx.commands.define(InitPurchaseCommand);
      ctx.commands.define(FinalizePurchaseCommand);
      ctx.commands.define(ConsumeItemCommand);
      ctx.commands.define(FetchInventoryCommand);

      const unbindInit = ctx.commands.handle("game.monetization.init-purchase", (env) => {
        const payload = env.payload as { sku: string };
        return service.initPurchase(payload.sku);
      });

      const unbindFinalize = ctx.commands.handle("game.monetization.finalize-purchase", (env) => {
        const payload = env.payload as { orderId: string };
        return service.finalizePurchase(payload.orderId);
      });

      const unbindConsume = ctx.commands.handle("game.monetization.consume-item", (env) => {
        const payload = env.payload as { itemId: string; quantity?: number };
        return service.consumeInventoryItem(payload.itemId, payload.quantity);
      });

      const unbindFetch = ctx.commands.handle("game.monetization.fetch-inventory", () => {
        return service.fetchSteamInventory();
      });

      ctx.lifecycle.onDispose(() => {
        unbindInit();
        unbindFinalize();
        unbindConsume();
        unbindFetch();
        service.clear();
      });

      ctx.lifecycle.ready();
    },
  };
}