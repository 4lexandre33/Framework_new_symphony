import type { Plugin, PluginContext } from "@core";
import { MonetizationToken } from "../../tokens/monetization";
import { SteamToken } from "../../tokens/steam";
import { StorageToken } from "../../tokens/storage";
import { UIToken } from "../../tokens/ui";
import { PurchaseInitiatedEvent, PurchaseCompletedEvent, PurchaseFailedEvent, WalletUpdatedEvent, InventoryRefreshedEvent, ItemGrantedEvent, InitPurchaseCommand, FinalizePurchaseCommand, ConsumeItemCommand, FetchInventoryCommand } from "../../contracts/monetization/types";
import { MonetizationService, type MonetizationServiceOptions } from "../../engine/monetization/internal/MonetizationService";

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
      "game.monetization.item-granted",
    ],
  },
  capabilities: {
    provides: [
      {
        id: MonetizationToken.id,
        version: "1.0.0",
      },
    ],
    consumes: [
      {
        id: SteamToken.id,
        range: "^1.0.0",
        optional: true,
      },
    ],
    conflicts: [],
  },
};

export function createMonetizationPlugin(options: MonetizationServiceOptions = {}): Plugin {
  return {
    manifest: monetizationManifest,

    setup(ctx: PluginContext) {
      const service = new MonetizationService(ctx, options);

      // SteamID do jogador só para o PurchaseProvider (resolvido na hora da compra).
      service.setSteamIdResolver(async () => {
        const steam = ctx.caps.get(SteamToken);
        if (!steam || !steam.isAvailable) return null;
        return (await steam.getUser())?.steamId ?? null;
      });

      const unbindAuthorization = ctx.events.on<
        "game.steam.microtxn-authorization",
        { orderId: string; authorized: boolean }
      >("game.steam.microtxn-authorization", (envelope) => {
        void service.handleMicroTxnAuthorization(envelope.payload.orderId, envelope.payload.authorized);
      });

      ctx.caps.provide(MonetizationToken, service);

      ctx.events.define(PurchaseInitiatedEvent);
      ctx.events.define(PurchaseCompletedEvent);
      ctx.events.define(PurchaseFailedEvent);
      ctx.events.define(WalletUpdatedEvent);
      ctx.events.define(InventoryRefreshedEvent);
      ctx.events.define(ItemGrantedEvent);

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
        unbindAuthorization();
        service.clear();
      });

      ctx.lifecycle.ready();
    },
  };
}