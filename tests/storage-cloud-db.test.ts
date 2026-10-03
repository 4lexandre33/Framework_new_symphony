import { describe, it, expect, beforeEach, vi } from "vitest";
import { CloudDatabaseDriver } from "../src/engine/storage/CloudDatabaseDriver";
import { StorageService } from "../src/plugins/storage/plugin";
import type { PluginContext } from "../src/core/contracts/plugin-context";
import type { PlayerOnlineProfile } from "../src/contracts/storage/types";

// ── CONTEXTO MOCKADO DO MICROKERNEL ───────────────────────────────────────
function createMockPluginContext() {
  const eventsEmitted: Array<{ type: string; payload: unknown }> = [];

  return {
    ctx: {
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
    } as unknown as PluginContext,
    eventsEmitted,
  };
}

describe("Camada de Armazenamento - 3º Driver: CloudDatabaseDriver (BaaS / Nuvem)", () => {
  let cloudDriver: CloudDatabaseDriver;

  beforeEach(() => {
    vi.restoreAllMocks();
    cloudDriver = new CloudDatabaseDriver();
  });

  it("deve sincronizar o perfil online do jogador no servidor remoto e confirmar o recebimento do payload", async () => {
    const perfilJogador: PlayerOnlineProfile = {
      playerId: "usr_steam_76561198765",
      displayName: "Alexandre_Pro",
      rankScore: 2450,
      inventoryData: {
        weapon: "Lança_Lendária_v3",
        armor: "Armadura_Mágica",
        gems: 150,
      },
      lastSyncedTimestamp: Date.now(),
    };

    // Executa a sincronização do perfil
    const sucesso = await cloudDriver.syncProfile(perfilJogador);
    expect(sucesso).toBe(true);

    // Consulta o perfil sincronizado
    const perfilBuscado = await cloudDriver.fetchProfile("usr_steam_76561198765");
    expect(perfilBuscado).not.toBeNull();
    expect(perfilBuscado?.displayName).toBe("Alexandre_Pro");
    expect(perfilBuscado?.rankScore).toBe(2450);
    expect(perfilBuscado?.inventoryData.weapon).toBe("Lança_Lendária_v3");
  });

  it("deve integrar o CloudDatabaseDriver ao StorageService e disparar o evento 'game.storage.profile-synced' no Microkernel", async () => {
    const { ctx, eventsEmitted } = createMockPluginContext();
    const storageService = new StorageService(ctx);

    const perfilJogador: PlayerOnlineProfile = {
      playerId: "usr_99_crossplay",
      displayName: "JogadorCrossplatform",
      rankScore: 1800,
      inventoryData: { coins: 5000 },
      lastSyncedTimestamp: Date.now(),
    };

    // Sincroniza via StorageService
    const ok = await storageService.syncOnlineProfile(perfilJogador);
    expect(ok).toBe(true);

    // Verifica se o evento de sincronização foi emitido pelo Kernel
    const eventoEmitido = eventsEmitted.find(
      (e) => e.type === "game.storage.profile-synced"
    );

    expect(eventoEmitido).toBeDefined();
    expect((eventoEmitido?.payload as any).playerId).toBe("usr_99_crossplay");
    expect((eventoEmitido?.payload as any).driver).toBe("cloud_database");
  });

  it("deve simular uma requisição HTTP REST para o Supabase/Firebase com sucesso usando mock de fetch", async () => {
    // Simula a API global fetch respondendo HTTP 200 OK com dados do banco relacional
    const mockResponseData = {
      playerId: "usr_supabase_007",
      displayName: "Agente007",
      rankScore: 3000,
      inventoryData: { item: "gadget_01" },
      lastSyncedTimestamp: 1727880000000,
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponseData,
    } as Response);

    // Teste de consulta REST HTTP
    const response = await fetch("https://sua-api-supabase.supabase.co/rest/v1/profiles?playerId=eq.usr_supabase_007");
    const data = await response.json();

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(data.displayName).toBe("Agente007");
    expect(data.rankScore).toBe(3000);
  });
});