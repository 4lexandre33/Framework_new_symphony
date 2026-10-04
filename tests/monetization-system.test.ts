import { describe, it, expect, beforeEach } from "vitest";
import { StoreCatalogRegistry } from "../src/engine/monetization/internal/StoreCatalogRegistry";
import { VirtualCurrencyWallet } from "../src/engine/monetization/internal/VirtualCurrencyWallet";
import { InventoryReceiptValidator } from "../src/engine/monetization/internal/InventoryReceiptValidator";

describe("Camada de Monetização & Microtransações (game.monetization)", () => {
  let catalog: StoreCatalogRegistry;
  let wallet: VirtualCurrencyWallet;
  let validator: InventoryReceiptValidator;

  beforeEach(() => {
    catalog = new StoreCatalogRegistry();
    wallet = new VirtualCurrencyWallet("player_123");
    validator = new InventoryReceiptValidator();
  });

  // ── 1. TESTES DO CATÁLOGO DE LOJA ──────────────────────────────────────────
  describe("StoreCatalogRegistry", () => {
    it("deve registrar e recuperar itens por SKU", () => {
      catalog.registerItem({
        sku: "starter_pack",
        title: "Pacote Inicial",
        description: "Itens para iniciantes",
        priceBaseCents: 499,
        currencyCode: "BRL",
        itemType: "bundle",
      });

      const item = catalog.getItem("starter_pack");
      expect(item).not.toBeNull();
      expect(item?.priceBaseCents).toBe(499);
    });

    it("deve rejeitar itens com preços negativos", () => {
      expect(() => {
        catalog.registerItem({
          sku: "invalid_item",
          title: "Inválido",
          description: "Erro",
          priceBaseCents: -100,
          currencyCode: "BRL",
          itemType: "consumable",
        });
      }).toThrow(/negativo/);
    });
  });

  // ── 2. TESTES DA CARTEIRA DE MOEDAS VIRTUAIS ────────────────────────────────
  describe("VirtualCurrencyWallet", () => {
    it("deve depositar e debitar moedas com precisão atômica", () => {
      wallet.credit("gold", 500, "quest_reward");
      expect(wallet.getBalance("gold")).toBe(500);

      const debited = wallet.debit("gold", 200, "buy_potion");
      expect(debited).toBe(true);
      expect(wallet.getBalance("gold")).toBe(300);
    });

    it("deve recusar débitos maiores do que o saldo atual", () => {
      wallet.credit("gems", 50);
      const debited = wallet.debit("gems", 100);

      expect(debited).toBe(false);
      expect(wallet.getBalance("gems")).toBe(50);
    });
  });

  // ── 3. TESTES DO VALIDADOR DE RECIBOS ───────────────────────────────────────
  describe("InventoryReceiptValidator", () => {
    it("deve validar recibos com assinaturas criptográficas legítimas", () => {
      const orderId = "ord_100";
      const transId = "txn_555";
      const steamId = "76561198000000000";
      const sku = "gold_pack_small";
      const amountCents = 199;

      const signature = validator.calculateSignature(orderId, transId, steamId, sku, amountCents);

      const isValid = validator.validateReceipt({
        orderId,
        transId,
        steamId,
        sku,
        amountCents,
        status: "approved",
        timestamp: Date.now(),
        signature,
      });

      expect(isValid).toBe(true);
    });

    it("deve rejeitar recibos adulterados ou com assinatura incompatível", () => {
      const isValid = validator.validateReceipt({
        orderId: "ord_fake",
        transId: "txn_fake",
        steamId: "76561198000000000",
        sku: "gold_pack_small",
        amountCents: 199,
        status: "approved",
        timestamp: Date.now(),
        signature: "sig_invalid_hash",
      });

      expect(isValid).toBe(false);
    });
  });
});