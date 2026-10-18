import type { Plugin, PluginContext } from "@core";
import { MonetizationToken } from "../../tokens/monetization";
import { SteamToken } from "../../tokens/steam";
import { StorageToken } from "../../tokens/storage";
import { UIToken } from "../../tokens/ui";
import { PurchaseInitiatedEvent, PurchaseCompletedEvent, PurchaseFailedEvent, WalletUpdatedEvent, InventoryRefreshedEvent, ItemGrantedEvent, InitPurchaseCommand, FinalizePurchaseCommand, ConsumeItemCommand, FetchInventoryCommand } from "../../contracts/monetization/types";
import type { PersistedWalletState, WalletPersistence, WalletPersistenceConfig } from "../../contracts/monetization/types";
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
      {
        id: StorageToken.id,
        range: "^1.0.0",
        optional: true,
      },
    ],
    conflicts: [],
  },
};

export type { WalletPersistenceConfig };

export interface MonetizationPluginOptions extends MonetizationServiceOptions {
  /**
   * Salva/restaura a carteira (saldos + entitlements) num slot do
   * `game.storage` (G135). Opcional: sem `game.storage` fica só em memória.
   * Fica no CLIENTE (editável pelo jogador): dinheiro real → servidor.
   * Jogos (que não controlam estas opções) usam, em runtime,
   * `MonetizationApi.enableWalletPersistence()`.
   */
  readonly persistWallet?: boolean | WalletPersistenceConfig;
}

export const DEFAULT_WALLET_SLOT = "monetization-wallet";

function storageWalletPersistence(ctx: PluginContext, config: WalletPersistenceConfig): WalletPersistence {
  const slotName = config.slotName ?? DEFAULT_WALLET_SLOT;
  const storage = () => {
    try {
      return ctx.caps.get(StorageToken) ?? null;
    } catch {
      return null;
    }
  };
  return {
    async load(): Promise<unknown> {
      const api = storage();
      if (!api) return null;
      const result = await api.loadGameDetailed<PersistedWalletState>(slotName, config.driver);
      if (result.status === "missing") return null;
      if (result.status === "corrupted") throw new Error(`Carteira salva corrompida (slot '${slotName}').`);
      return result.data;
    },
    async save(state: PersistedWalletState): Promise<void> {
      const api = storage();
      if (!api) throw new Error("game.storage indisponível: carteira não persistida.");
      await api.saveGame(slotName, state as unknown as Record<string, unknown>, config.driver, { label: "wallet" });
    },
  };
}

export function createMonetizationPlugin(options: MonetizationPluginOptions = {}): Plugin {
  return {
    manifest: monetizationManifest,

    setup(ctx: PluginContext) {
      const persistConfig =
        options.persistWallet === true ? {} : options.persistWallet === false || options.persistWallet === undefined ? null : options.persistWallet;
      const service = new MonetizationService(ctx, {
        ...options,
        walletPersistence:
          options.walletPersistence ?? (persistConfig !== null ? storageWalletPersistence(ctx, persistConfig) : undefined),
        walletPersistenceFactory:
          options.walletPersistenceFactory ??
          ((config) => {
            // Só liga se o game.storage existe (senão o método resolve false).
            try {
              if (!ctx.caps.get(StorageToken)) return null;
            } catch {
              return null;
            }
            return storageWalletPersistence(ctx, config);
          }),
      });

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
        service.detachWalletPersistence();
        service.clear();
      });

      ctx.lifecycle.ready();
    },
  };
}