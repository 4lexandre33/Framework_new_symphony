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
  // G119: a validação local por sal embutido foi removida. Um recibo só é
  // válido se foi aprovado pelo PurchaseProvider (servidor) nesta sessão.
  describe("InventoryReceiptValidator", () => {
    const receipt = {
      orderId: "ord_100",
      transId: "txn_555",
      steamId: "76561198000000000",
      sku: "gold_pack_small",
      amountCents: 199,
      status: "approved" as const,
      timestamp: Date.now(),
      signature: "server-signed",
    };

    it("aceita apenas recibos aprovados pelo provedor nesta sessão", () => {
      expect(validator.validateReceipt(receipt)).toBe(false);
      validator.markVerified(receipt);
      expect(validator.validateReceipt(receipt)).toBe(true);
    });

    it("deve rejeitar recibos adulterados ou com assinatura incompatível", () => {
      validator.markVerified(receipt);
      expect(validator.validateReceipt({ ...receipt, amountCents: 1 })).toBe(false);
      expect(validator.validateReceipt({ ...receipt, signature: "sig_invalid_hash" })).toBe(false);
    });
  });
});
