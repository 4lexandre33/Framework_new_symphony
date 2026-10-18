// @vitest-environment node
// Revisão: persistWallet/seedDefaultCatalog eram inalcançáveis para jogos (o
// src/app cria createMonetizationPlugin() sem opções). Agora há API em runtime.
import { describe, expect, it, vi } from "vitest";
import type { PluginContext } from "@core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => {
    throw new Error("sem tauri");
  }),
}));

import { createMonetizationPlugin, DEFAULT_WALLET_SLOT } from "../src/plugins/monetization/plugin";
import { StorageService } from "../src/engine/storage/internal/StorageService";
import { MemoryKeyValueStorageBackend } from "../src/engine/storage/internal/KeyValueStorageBackend";
import { MonetizationToken, type MonetizationApi } from "../src/tokens/monetization";
import { StorageToken, type StorageApi } from "../src/tokens/storage";

interface Caps {
  get<T>(token: { id: string }): T | undefined;
}

/** Boot igual ao do src/app: plugin SEM opções; o jogo só vê os tokens. */
async function bootLikeApp(backend: MemoryKeyValueStorageBackend | null): Promise<{ caps: Caps; dispose: () => void }> {
  const storageCtx = { events: { emit: () => undefined } } as unknown as PluginContext;
  const storage = backend ? new StorageService(storageCtx, { backend }) : null;
  const provided = new Map<string, unknown>();
  if (storage) provided.set(StorageToken.id, storage);
  const disposers: Array<() => void> = [];
  const caps = {
    get: <T,>(token: { id: string }) => provided.get(token.id) as T | undefined,
    provide: (token: { id: string }, value: unknown) => provided.set(token.id, value),
  };
  const ctx = {
    caps,
    events: { emit: () => undefined, on: () => () => undefined, define: () => undefined },
    commands: { define: () => undefined, handle: () => () => undefined },
    lifecycle: { onDispose: (fn: () => void) => disposers.push(fn), ready: () => undefined },
  } as unknown as PluginContext;
  await createMonetizationPlugin().setup(ctx);
  return { caps, dispose: () => disposers.forEach((fn) => fn()) };
}

/** Código "de projeto" (src/projects/<id>): só usa a API pública. */
async function projectSetup(monetization: MonetizationApi): Promise<boolean> {
  monetization.seedSampleCatalog();
  return await monetization.enableWalletPersistence({ slotName: "carteira" });
}

describe("MonetizationApi em runtime (sem opções do plugin)", () => {
  it("seedSampleCatalog registra os SKUs de exemplo sem apagar o catálogo do jogo", async () => {
    const { caps } = await bootLikeApp(null);
    const api = caps.get<MonetizationApi>(MonetizationToken)!;
    expect(api.getCatalog()).toEqual([]);
    api.registerCatalogItem({
      sku: "skin_red",
      title: "Skin",
      description: "",
      priceBaseCents: 99,
      currencyCode: "BRL",
      itemType: "durable",
    });
    expect(api.seedSampleCatalog()).toEqual(["gold_pack_small", "gold_pack_large"]);
    expect(api.getCatalog().map((item) => item.sku).sort()).toEqual(["gold_pack_large", "gold_pack_small", "skin_red"]);
  });

  it("enableWalletPersistence restaura, soma o que já estava em memória e persiste entre sessões", async () => {
    const backend = new MemoryKeyValueStorageBackend();

    const first = await bootLikeApp(backend);
    const api1 = first.caps.get<MonetizationApi>(MonetizationToken)!;
    expect(api1.isWalletPersistent()).toBe(false);
    api1.creditCurrency("gold", 5, "antes-de-ligar");
    expect(await projectSetup(api1)).toBe(true);
    expect(api1.isWalletPersistent()).toBe(true);
    api1.creditCurrency("gold", 10);
    expect(await api1.saveWallet()).toBe(true);
    // idempotente: ligar de novo não soma nem troca de slot
    expect(await api1.enableWalletPersistence({ slotName: "outro" })).toBe(true);
    expect(api1.getWalletBalance("gold")).toBe(15);
    first.dispose();

    const second = await bootLikeApp(backend);
    const api2 = second.caps.get<MonetizationApi>(MonetizationToken)!;
    expect(await projectSetup(api2)).toBe(true);
    expect(api2.getWalletBalance("gold")).toBe(15);
    const storage = second.caps.get<StorageApi>(StorageToken)!;
    const slots = (await storage.listSaves()).map((meta) => meta.slotName);
    expect(slots).toContain("carteira");
    expect(slots).not.toContain(DEFAULT_WALLET_SLOT);
    expect(slots).not.toContain("outro");
  });

  it("sem game.storage ou com config inválida resolve false e continua só em memória", async () => {
    const { caps } = await bootLikeApp(null);
    const api = caps.get<MonetizationApi>(MonetizationToken)!;
    expect(await api.enableWalletPersistence()).toBe(false);
    expect(await api.enableWalletPersistence({ slotName: "  " })).toBe(false);
    expect(api.isWalletPersistent()).toBe(false);
    expect(api.creditCurrency("gold", 3)).toBe(3);
  });
});
