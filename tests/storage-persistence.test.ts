import { describe, it, expect, beforeEach } from "vitest";
import { LocalDatabaseDriver } from "../src/engine/storage/internal/LocalDatabaseDriver";
import { SteamCloudDriver } from "../src/engine/storage/internal/SteamCloudDriver";
import { StorageService } from "../src/engine/storage/internal/StorageService";
import type { PluginContext } from "@core";
import type { SaveGameMetadata } from "../src/contracts/storage/types";

// ── POLYFILL DE LOCALSTORAGE PARA AMBIENTE NODE.JS / VITEST ────────────────
class MockLocalStorage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  public clear(): void {
    this.store.clear();
  }

  public getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  public setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }

  public removeItem(key: string): void {
    this.store.delete(key);
  }

  public key(index: number): string | null {
    const keys = Array.from(this.store.keys());
    return keys[index] ?? null;
  }
}

if (typeof globalThis.localStorage === "undefined") {
  (globalThis as any).localStorage = new MockLocalStorage();
}

// ── CONTEXTO MOCKADO DO MICROKERNEL ───────────────────────────────────────
function createMockPluginContext(): PluginContext {
  const eventsEmitted: Array<{ type: string; payload: unknown }> = [];

  return {
    events: {
      define: () => {},
      emit: (type: string, payload: unknown) => {
        eventsEmitted.push({ type, payload });
      },
      on: () => () => {},
      once: () => () => {},
    },
    commands: {
      define: () => {},
      handle: () => () => {},
    },
    caps: {
      provide: () => {},
      get: () => null,
      getOptional: () => null,
    },
    lifecycle: {
      ready: () => {},
      onDispose: () => {},
    },
  } as unknown as PluginContext;
}

describe("Validação de Persistência Real - game.storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("deve gravar um save de progresso na Steam Cloud, gerar checksum válido e reter os dados após releitura", async () => {
    const mockCtx = createMockPluginContext();
    const storageService = new StorageService(mockCtx);

    const dadosSaveOriginal = {
      playerSteamId: "76561198765756356",
      playerName: "Alexandre",
      currentLevel: "Fase_03_Cavernas",
      coins: 1450,
      inventory: ["espada_ferro", "pocao_cura", "escudo_madeira"],
      playTimeSeconds: 3600,
      timestamp: Date.now(),
    };

    // 1. Grava o save na Steam Cloud
    const metadata: SaveGameMetadata = await storageService.saveGame(
      "slot_steam_main",
      dadosSaveOriginal,
      "steam_cloud"
    );

    expect(metadata).not.toBeNull();
    expect(metadata.slotName).toBe("slot_steam_main");
    expect(metadata.checksum).toBeDefined();
    expect(metadata.checksum.length).toBeGreaterThan(0);

    // 2. Simula o fechamento e reabertura do jogo (nova instância do serviço)
    const novoStorageService = new StorageService(mockCtx);

    // 3. Lê o save gravado
    const dadosCarregados = await novoStorageService.loadGame<{
      playerSteamId: string;
      playerName: string;
      currentLevel: string;
      coins: number;
      inventory: string[];
    }>("slot_steam_main", "steam_cloud");

    expect(dadosCarregados).not.toBeNull();
    expect(dadosCarregados?.playerName).toBe("Alexandre");
    expect(dadosCarregados?.coins).toBe(1450);
    expect(dadosCarregados?.inventory).toContain("espada_ferro");
  });

  it("deve persistir dados no banco local (SQLite/LocalDB) e permitir exclusão segura", async () => {
    const mockCtx = createMockPluginContext();
    const storageService = new StorageService(mockCtx);

    const preferenciasLocais = {
      masterVolume: 0.8,
      graphicsQuality: "ultra",
      keyBindings: { Jump: "Space", Attack: "Mouse0" },
    };

    // Grava no driver local
    await storageService.saveGame("settings", preferenciasLocais, "sqlite_local");

    // Releitura
    const carregado = await storageService.loadGame<typeof preferenciasLocais>(
      "settings",
      "sqlite_local"
    );

    expect(carregado).not.toBeNull();
    expect(carregado?.graphicsQuality).toBe("ultra");

    // Remove o save
    const apagado = await storageService.deleteSave("settings", "sqlite_local");
    expect(apagado).toBe(true);

    // Confirma que não existe mais
    const posDelecao = await storageService.loadGame("settings", "sqlite_local");
    expect(posDelecao).toBeNull();
  });
});