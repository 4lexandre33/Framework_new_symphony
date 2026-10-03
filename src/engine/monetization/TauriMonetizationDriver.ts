import { invoke } from "@tauri-apps/api/core";
import type { TransactionReceiptDTO, SteamInventoryItemDTO } from "../../contracts/monetization/types";

export class TauriMonetizationDriver {
  public async initPurchase(
    sku: string,
    amountCents: number
  ): Promise<TransactionReceiptDTO | null> {
    try {
      return await invoke<TransactionReceiptDTO>("monetization_init_purchase", {
        sku,
        amountCents,
      });
    } catch (err) {
      console.warn("[TauriMonetizationDriver] Simulando inicialização de compra fora do Tauri:", err);
      return null;
    }
  }

  public async finalizePurchase(orderId: string): Promise<boolean> {
    try {
      return await invoke<boolean>("monetization_finalize_purchase", { orderId });
    } catch {
      return true; // Fallback simulado
    }
  }

  public async fetchSteamInventory(): Promise<ReadonlyArray<SteamInventoryItemDTO>> {
    try {
      return await invoke<ReadonlyArray<SteamInventoryItemDTO>>("monetization_fetch_inventory");
    } catch {
      return [];
    }
  }

  public async consumeSteamItem(itemId: string, quantity: number): Promise<boolean> {
    try {
      return await invoke<boolean>("monetization_consume_item", { itemId, quantity });
    } catch {
      return true;
    }
  }
}