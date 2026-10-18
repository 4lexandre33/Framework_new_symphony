// @vitest-environment node
// G135: persistência opcional da carteira, catálogo de exemplo opt-in.
import { describe, expect, it, vi } from "vitest";
import type { PluginContext } from "@core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => {
    throw new Error("sem tauri");
  }),
}));

import { MonetizationService } from "../src/engine/monetization/internal/MonetizationService";
import type { PersistedWalletState, WalletPersistence } from "../src/contracts/monetization/types";
import { createMonetizationPlugin, DEFAULT_WALLET_SLOT } from "../src/plugins/monetization/plugin";
import { StorageService } from "../src/engine/storage/internal/StorageService";
import { MemoryKeyValueStorageBackend } from "../src/engine/storage/internal/KeyValueStorageBackend";
import { MonetizationToken, type MonetizationApi } from "../src/tokens/monetization";
import { StorageToken } from "../src/tokens/storage";

type Emitted = Array<{ type: string; payload: any }>;

function ctxWith(emitted: Emitted): PluginContext {
  return {
    events: { emit: (type: string, payload: unknown) => emitted.push({ type, payload }) },
  } as unknown as PluginContext;
}

class MemoryWallet implements WalletPersistence {
  public stored: unknown = null;
  public saves: PersistedWalletState[] = [];
  public failLoad = false;
  public gate: Promise<void> = Promise.resolve();

  public async load(): Promise<unknown> {
    await this.gate;
    if (this.failLoad) throw new Error("disco");
    return this.stored;
  }

  public async save(state: PersistedWalletState): Promise<void> {
    this.saves.push(state);
    this.stored = JSON.parse(JSON.stringify(state));
  }
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

describe("G135 carteira persistente", () => {
  it("sem persistência: só memória, APIs respondem false", async () => {
    const service = new MonetizationService(ctxWith([]));
    expect(service.isWalletPersistent()).toBe(false);
    expect(await service.restoreWallet()).toBe(false);
    expect(await service.saveWallet()).toBe(false);
    expect(service.getCatalog()).toEqual([]); // catálogo de exemplo é opt-in
  });

  it("restaura no boot, soma o que mudou antes e salva a cada mudança depois", async () => {
    const store = new MemoryWallet();
    store.stored = { version: 1, currencies: { gold: 100, "bad id": 5, gems: -3 }, entitlements: { sword: 1 } };
    let release!: () => void;
    store.gate = new Promise((resolve) => (release = resolve));
    const emitted: Emitted = [];
    const service = new MonetizationService(ctxWith(emitted), { walletPersistence: store });

    service.creditCurrency("gold", 5, "quest"); // antes da restauração terminar
    expect(store.saves).toHaveLength(0); // nada sobrescreve o save antes de restaurar

    release();
    expect(await service.restoreWallet()).toBe(true);
    await flush();
    expect(service.getWalletBalance("gold")).toBe(105);
    expect(service.getWalletBalance("gems")).toBe(0);
    expect(service.getEntitlements()).toEqual({ sword: 1 });
    expect(emitted.some((e) => e.type === "game.monetization.wallet-updated" && e.payload.reason === "restore")).toBe(true);
    expect(store.stored).toEqual({ version: 1, currencies: { gold: 105 }, entitlements: { sword: 1 } });

    expect(service.debitCurrency("gold", 30)).toBe(true);
    await flush();
    expect((store.stored as PersistedWalletState).currencies.gold).toBe(75);

    // Idempotente: restaurar de novo não soma outra vez.
    expect(await service.restoreWallet()).toBe(true);
    expect(service.getWalletBalance("gold")).toBe(75);
  });

  it("mudanças em rajada se juntam (sem timers) e o último estado vence", async () => {
    const store = new MemoryWallet();
    const service = new MonetizationService(ctxWith([]), { walletPersistence: store });
    await service.restoreWallet();
    for (let i = 0; i < 20; i += 1) service.creditCurrency("gold", 1);
    await flush();
    expect(store.saves.length).toBeLessThan(20);
    expect((store.stored as PersistedWalletState).currencies.gold).toBe(20);
  });

  it("falha na leitura desliga o autosave; saveWallet explícito ainda grava", async () => {
    const store = new MemoryWallet();
    store.failLoad = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const service = new MonetizationService(ctxWith([]), { walletPersistence: store });
    expect(await service.restoreWallet()).toBe(false);
    service.creditCurrency("gold", 10);
    await flush();
    expect(store.saves).toHaveLength(0);
    expect(await service.saveWallet()).toBe(true);
    expect((store.stored as PersistedWalletState).currencies.gold).toBe(10);
    warn.mockRestore();
  });

  it("clear() e dispose não apagam o save", async () => {
    const store = new MemoryWallet();
    const service = new MonetizationService(ctxWith([]), { walletPersistence: store });
    await service.restoreWallet();
    service.creditCurrency("gold", 7);
    await flush();
    service.detachWalletPersistence();
    service.clear();
    await flush();
    expect((store.stored as PersistedWalletState).currencies.gold).toBe(7);
  });

  it("plugin persistWallet usa o game.storage (opcional) e restaura em outra sessão", async () => {
    const backend = new MemoryKeyValueStorageBackend();
    const storageCtx = { events: { emit: () => undefined } } as unknown as PluginContext;

    async function boot(): Promise<{ api: MonetizationApi; dispose: () => void }> {
      const storage = new StorageService(storageCtx, { backend });
      let api: MonetizationApi | null = null;
      const disposers: Array<() => void> = [];
      const ctx = {
        caps: {
          get: (token: { id: string }) => (token.id === StorageToken.id ? storage : undefined),
          provide: (token: { id: string }, value: MonetizationApi) => {
            if (token.id === MonetizationToken.id) api = value;
          },
        },
        events: { emit: () => undefined, on: () => () => undefined, define: () => undefined },
        commands: { define: () => undefined, handle: () => () => undefined },
        lifecycle: { onDispose: (fn: () => void) => disposers.push(fn), ready: () => undefined },
      } as unknown as PluginContext;
      await createMonetizationPlugin({ persistWallet: true }).setup(ctx);
      return { api: api!, dispose: () => disposers.forEach((fn) => fn()) };
    }

    const first = await boot();
    expect(first.api.isWalletPersistent()).toBe(true);
    expect(manifestConsumesStorage()).toBe(true);
    await first.api.restoreWallet();
    first.api.creditCurrency("gold", 42);
    await first.api.saveWallet();
    first.dispose(); // clear() no dispose não grava zeros

    const second = await boot();
    expect(await second.api.restoreWallet()).toBe(true);
    expect(second.api.getWalletBalance("gold")).toBe(42);
    const storage = new StorageService(storageCtx, { backend });
    expect((await storage.listSaves()).map((m) => m.slotName)).toContain(DEFAULT_WALLET_SLOT);
  });

  it("plugin sem game.storage: persistência declarada mas restaura vazio sem lançar", async () => {
    let api: MonetizationApi | null = null;
    const ctx = {
      caps: {
        get: () => {
          throw new Error("capability ausente");
        },
        provide: (_t: unknown, value: MonetizationApi) => (api = value),
      },
      events: { emit: () => undefined, on: () => () => undefined, define: () => undefined },
      commands: { define: () => undefined, handle: () => () => undefined },
      lifecycle: { onDispose: () => undefined, ready: () => undefined },
    } as unknown as PluginContext;
    await createMonetizationPlugin({ persistWallet: { slotName: "w" } }).setup(ctx);
    expect(await api!.restoreWallet()).toBe(true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await api!.saveWallet()).toBe(false);
    warn.mockRestore();
  });
});

function manifestConsumesStorage(): boolean {
  const consumes = createMonetizationPlugin().manifest.capabilities?.consumes ?? [];
  return consumes.some((entry) => entry.id === StorageToken.id && entry.optional === true);
}
