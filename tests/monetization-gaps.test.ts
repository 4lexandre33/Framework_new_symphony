// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { PluginContext } from "@core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => {
    throw new Error("sem tauri");
  }),
}));

import { MonetizationService } from "../src/engine/monetization/internal/MonetizationService";
import { TauriMonetizationDriver } from "../src/engine/monetization/internal/TauriMonetizationDriver";
import type {
  PurchaseProvider,
  SteamInventoryItemDTO,
  TransactionReceiptDTO,
  VerifiedPurchase,
} from "../src/contracts/monetization/types";
import { createMonetizationPlugin, monetizationManifest } from "../src/plugins/monetization/plugin";

type Emitted = Array<{ type: string; payload: unknown }>;

function ctxWith(emitted: Emitted): PluginContext {
  return {
    log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
    events: { emit: (type: string, payload: unknown) => emitted.push({ type, payload }) },
  } as unknown as PluginContext;
}

function approved(orderId: string, sku: string, extra: Partial<VerifiedPurchase> = {}): VerifiedPurchase {
  const receipt: TransactionReceiptDTO = {
    orderId,
    transId: `t_${orderId}`,
    steamId: "76561198000000001",
    sku,
    amountCents: 499,
    status: "approved",
    timestamp: 1,
    signature: "server",
  };
  return { status: "approved", receipt, ...extra };
}

class FakeProvider implements PurchaseProvider {
  public readonly id = "test-server";
  public next = 1;
  public outcome: (orderId: string, sku: string) => VerifiedPurchase = (orderId, sku) => approved(orderId, sku);
  private readonly skus = new Map<string, string>();
  public async initPurchase(request: { sku: string }): Promise<{ orderId: string; amountCents: number }> {
    const orderId = `ord_${this.next++}`;
    this.skus.set(orderId, request.sku);
    return { orderId, amountCents: 499 };
  }
  public async finalizePurchase(orderId: string): Promise<VerifiedPurchase> {
    return this.outcome(orderId, this.skus.get(orderId) ?? "");
  }
  public async verifyReceipt(receipt: TransactionReceiptDTO): Promise<boolean> {
    return receipt.signature === "server";
  }
}

describe("monetization gaps", () => {
  it("G13: catálogo registrável pelo jogo (validado, tudo ou nada, replace)", () => {
    // G135: catálogo de exemplo só por opt-in (padrão vazio).
    expect(new MonetizationService(ctxWith([])).getCatalog()).toEqual([]);
    const service = new MonetizationService(ctxWith([]), { seedDefaultCatalog: true });
    expect(service.getCatalog().map((item) => item.sku)).toEqual(["gold_pack_small", "gold_pack_large"]);

    service.registerCatalog(
      [
        { sku: "gems_100", title: "100 Gemas", description: "", priceBaseCents: 299, currencyCode: "USD", itemType: "currency", grantedCurrencyAmount: 100, grantedCurrencyId: "gems" },
        { sku: "skin_red", title: "Skin", description: "", priceBaseCents: 199, currencyCode: "USD", itemType: "durable", steamItemDefId: 1001 },
      ],
      { replace: true },
    );
    expect(service.getCatalog().map((item) => item.sku)).toEqual(["gems_100", "skin_red"]);

    expect(() =>
      service.registerCatalog([
        { sku: "ok", title: "Ok", description: "", priceBaseCents: 1, currencyCode: "USD", itemType: "consumable" },
        { sku: "bad sku", title: "X", description: "", priceBaseCents: 1, currencyCode: "USD", itemType: "consumable" },
      ]),
    ).toThrow();
    expect(service.getItemBySku("ok")).toBeNull(); // nada aplicado

    expect(() => service.registerCatalogItem({ sku: "frac", title: "F", description: "", priceBaseCents: 1.5, currencyCode: "USD", itemType: "consumable" })).toThrow();
    expect(() => service.registerCatalogItem({ sku: "cur", title: "C", description: "", priceBaseCents: 1, currencyCode: "real", itemType: "consumable" })).toThrow();
    expect(service.removeCatalogItem("skin_red")).toBe(true);
    expect(new MonetizationService(ctxWith([]), { seedDefaultCatalog: false }).getCatalog()).toEqual([]);
  });

  it("G119: sem provedor NÃO há compra (nenhum ouro fabricado)", async () => {
    const emitted: Emitted = [];
    const service = new MonetizationService(ctxWith(emitted), { seedDefaultCatalog: true });
    expect(service.isPurchaseSupported()).toBe(false);
    expect(await service.initPurchase("gold_pack_small")).toBeNull();
    expect(emitted.find((e) => e.type === "game.monetization.purchase-failed")?.payload).toMatchObject({ reason: "unsupported" });
    expect(await service.finalizePurchase("anything")).toBe(false);
    expect(service.getWalletBalance("gold")).toBe(0);
    expect(service.getWalletSnapshot().pendingTransactionsCount).toBe(0);
  });

  it("G119: fluxo real via provedor credita só o concedido e valida recibo só pelo provedor", async () => {
    const emitted: Emitted = [];
    const service = new MonetizationService(ctxWith(emitted));
    const provider = new FakeProvider();
    service.setPurchaseProvider(provider);
    service.setSteamIdResolver(async () => "76561198000000001");
    service.registerCatalogItem({ sku: "gems_100", title: "Gemas", description: "", priceBaseCents: 299, currencyCode: "USD", itemType: "currency", grantedCurrencyAmount: 100, grantedCurrencyId: "gems" });
    service.registerCatalogItem({ sku: "bundle", title: "Bundle", description: "", priceBaseCents: 999, currencyCode: "USD", itemType: "bundle", grantedItemSkus: ["sword", "shield"] });

    const receipt = await service.initPurchase("gems_100");
    expect(receipt).toMatchObject({ orderId: "ord_1", status: "pending", steamId: "76561198000000001" });
    expect(service.getWalletSnapshot().pendingTransactionsCount).toBe(1);
    expect(await service.finalizePurchase("ord_1")).toBe(true);
    expect(service.getWalletBalance("gems")).toBe(100);
    expect(service.getWalletBalance("gold")).toBe(0);
    expect(await service.finalizePurchase("ord_1")).toBe(false); // não credita duas vezes

    const completed = emitted.find((e) => e.type === "game.monetization.purchase-completed")?.payload as { receipt: TransactionReceiptDTO };
    expect(service.validateReceipt(completed.receipt)).toBe(true);
    expect(service.validateReceipt({ ...completed.receipt, amountCents: 1 })).toBe(false);
    expect(await service.verifyReceipt({ ...completed.receipt, orderId: "other" })).toBe(true);

    await service.initPurchase("bundle");
    expect(await service.finalizePurchase("ord_2")).toBe(true);
    expect(service.getEntitlements()).toEqual({ sword: 1, shield: 1 });

    // o servidor é autoridade: concede só o que devolveu em `grants`
    provider.outcome = (orderId, sku) => approved(orderId, sku, { grants: { currencies: { gems: 5, bad: Number.NaN } } });
    await service.initPurchase("gems_100");
    expect(await service.finalizePurchase("ord_3")).toBe(true);
    expect(service.getWalletBalance("gems")).toBe(105);
    expect(service.getWalletBalance("bad")).toBe(0);

    // recusa do servidor e cancelamento pelo usuário
    provider.outcome = (orderId, sku) => ({ ...approved(orderId, sku), status: "failed", receipt: { ...approved(orderId, sku).receipt, status: "failed" }, reason: "declined" });
    await service.initPurchase("gems_100");
    expect(await service.finalizePurchase("ord_4")).toBe(false);
    expect(emitted.some((e) => e.type === "game.monetization.purchase-failed" && (e.payload as { reason: string }).reason === "declined")).toBe(true);

    provider.outcome = (orderId, sku) => approved(orderId, sku);
    await service.initPurchase("gems_100");
    expect(await service.handleMicroTxnAuthorization("ord_5", false)).toBe(false);
    expect(emitted.some((e) => (e.payload as { reason?: string }).reason === "user_cancelled")).toBe(true);
    await service.initPurchase("gems_100");
    expect(await service.handleMicroTxnAuthorization("ord_6", true)).toBe(true);
    expect(service.getWalletBalance("gems")).toBe(205);

    // recibo malformado do provedor é rejeitado
    provider.outcome = (orderId) => approved(orderId, "other_sku");
    await service.initPurchase("gems_100");
    expect(await service.finalizePurchase("ord_7")).toBe(false);

    expect(() => service.setPurchaseProvider({} as PurchaseProvider)).toThrow();
  });

  it("G120: carteira valida entradas, suprime no-op e clear() é seguro", () => {
    const emitted: Emitted = [];
    const service = new MonetizationService(ctxWith(emitted), { seedDefaultCatalog: true });
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -5, 0, 1.5, Number.MAX_SAFE_INTEGER + 2]) {
      expect(service.creditCurrency("gold", bad)).toBe(0);
      expect(service.debitCurrency("gold", bad)).toBe(false);
    }
    expect(service.creditCurrency("", 10)).toBe(0);
    expect(emitted.filter((e) => e.type === "game.monetization.wallet-updated")).toHaveLength(0);
    expect(Number.isNaN(service.getWalletBalance("gold"))).toBe(false);

    expect(service.creditCurrency("gold", Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    expect(service.creditCurrency("gold", 1)).toBe(Number.MAX_SAFE_INTEGER); // estouro recusado
    expect(emitted.filter((e) => e.type === "game.monetization.wallet-updated")).toHaveLength(1);
    expect(service.debitCurrency("gold", 10)).toBe(true);

    service.clear();
    expect(service.getWalletBalance("gold")).toBe(0);
    expect(service.getCatalog().length).toBeGreaterThan(0); // catálogo sobrevive
    expect(service.creditCurrency("gold", 3)).toBe(3);
  });

  it("G119: Steam Inventory mapeia definição → SKU e compra abre checkout real", async () => {
    class FakeDriver extends TauriMonetizationDriver {
      public started: Array<[number, number]> = [];
      public override async fetchSteamInventory(): Promise<ReadonlyArray<SteamInventoryItemDTO>> {
        return [{ itemId: "9", definitionId: 1001, sku: "def:1001", quantity: 1, acquiredTimestamp: 1, isTradable: true, isMarketable: false }];
      }
      public override async startInventoryPurchase(def: number, qty: number): Promise<boolean> {
        this.started.push([def, qty]);
        return true;
      }
    }
    const driver = new FakeDriver();
    const service = new MonetizationService(ctxWith([]), { tauriDriver: driver });
    service.registerCatalogItem({ sku: "skin_red", title: "Skin", description: "", priceBaseCents: 199, currencyCode: "USD", itemType: "durable", steamItemDefId: 1001 });
    expect((await service.fetchSteamInventory())[0]?.sku).toBe("skin_red");
    expect(await service.startInventoryPurchase("skin_red", 2)).toBe(true);
    expect(driver.started).toEqual([[1001, 2]]);
    expect(await service.startInventoryPurchase("gold_pack_small")).toBe(false);
    expect(await new MonetizationService(ctxWith([])).startInventoryPurchase("x")).toBe(false);
    expect(await service.consumeInventoryItem("9", Number.NaN)).toBe(false);
  });

  it("plugin: escuta autorização MicroTxn e declara item-granted", () => {
    expect(monetizationManifest.permissions?.events).toContain("game.monetization.item-granted");
    expect(createMonetizationPlugin({ seedDefaultCatalog: false }).manifest.id).toBe("game.monetization");
  });
});
