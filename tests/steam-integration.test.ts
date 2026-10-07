import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import { SteamBridgeService } from "../src/engine/steam/internal/SteamBridgeService";
import { steamManifest } from "../src/plugins/steam/plugin";
import { SteamToken } from "../src/tokens/steam";
import { SteamNetworkToken } from "../src/tokens/steam-net";

const nativeState = vi.hoisted(() => ({
  online: true,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string, args?: Record<string, unknown>): Promise<unknown> => {
    if (command === "steam_is_initialized") return nativeState.online;
    if (!nativeState.online) throw new Error("Steam offline");

    switch (command) {
      case "steam_get_user":
        return {
          steamId: "76561198765756356",
          personaName: "TestPlayer",
          isOverlayEnabled: true,
        };
      case "steam_create_lobby":
        return {
          lobbyId: "109775241012345678",
          ownerSteamId: "76561198765756356",
          memberCount: 1,
          maxMembers: args?.maxMembers ?? 4,
        };
      case "steam_join_lobby":
      case "steam_leave_lobby":
      case "steam_set_lobby_data":
      case "steam_send_p2p_packet":
      case "steam_accept_p2p_session":
      case "steam_close_p2p_session":
      case "steam_unlock_achievement":
      case "steam_set_stat":
      case "steam_store_stats":
        return true;
      case "steam_get_lobby_data":
        return "arena";
      case "steam_read_p2p_packet":
        return {
          sourceSteamId: "76561198000000000",
          channel: args?.channel ?? 0,
          data: [10, 20, 30, 40, 50],
          bytesReceived: 5,
        };
      case "steam_get_p2p_session_state":
        return {
          isConnectionActive: true,
          isConnecting: false,
          lastError: 0,
          usingRelay: true,
          bytesQueuedForSend: 64,
          packetsQueuedForSend: 1,
          remoteSteamId: args?.remoteSteamId,
        };
      default:
        return null;
    }
  }),
}));

describe("Layer 1 Stage 84 — Steamworks bridge", (): void => {
  beforeEach((): void => {
    nativeState.online = true;
    vi.clearAllMocks();
  });

  it("preserva game.steam como provider canônico e mantém game.steam.net dormente", (): void => {
    const provided = steamManifest.capabilities?.provides?.map((entry) => entry.id) ?? [];
    expect(provided).toContain(SteamToken.id);
    expect(provided).not.toContain(SteamNetworkToken.id);
    expect(steamManifest.permissions?.capabilities).not.toContain(SteamNetworkToken.id);
  });

  it("normaliza usuário, lobby, metadata e estado P2P", async (): Promise<void> => {
    const service = new SteamBridgeService();

    expect(await service.checkAvailability()).toBe(true);
    expect(await service.getUser()).toEqual({
      steamId: "76561198765756356",
      personaName: "TestPlayer",
      isOverlayEnabled: true,
    });

    const lobby = await service.createLobby("public", 4);
    expect(lobby).toEqual({
      lobbyId: "109775241012345678",
      ownerSteamId: "76561198765756356",
      memberCount: 1,
      maxMembers: 4,
      lobbyType: "public",
      metadata: {},
    });

    expect(await service.joinLobby("109775241012345678")).toBe(true);
    expect(await service.setLobbyData("109775241012345678", "map", "arena")).toBe(true);
    expect(await service.getLobbyData("109775241012345678", "map")).toBe("arena");
    expect(await service.leaveLobby("109775241012345678")).toBe(true);

    expect(await service.getP2PSessionState("76561198000000000")).toEqual({
      isConnectionActive: true,
      isConnecting: false,
      lastError: 0,
      usingRelay: true,
      bytesQueuedForSend: 64,
      packetsQueuedForSend: 1,
      remoteSteamId: "76561198000000000",
    });
  });

  it("preserva canal e payload binário no P2P", async (): Promise<void> => {
    const service = new SteamBridgeService();
    await service.checkAvailability();

    const payload = Uint8Array.from([1, 2, 3, 4]);
    expect(await service.sendP2PPacket("76561198000000000", payload, "reliable", 7)).toBe(true);

    const packet = await service.readP2PPacket(7);
    expect(packet?.channel).toBe(7);
    expect(Array.from(packet?.data ?? [])).toEqual([10, 20, 30, 40, 50]);
    expect(packet?.bytesReceived).toBe(5);

    expect(vi.mocked(invoke)).toHaveBeenCalledWith("steam_send_p2p_packet", {
      targetSteamId: "76561198000000000",
      data: [1, 2, 3, 4],
      sendType: "reliable",
      channel: 7,
    });
  });

  it("falha fechado antes do IPC para IDs, canais, lobby size e pacotes inválidos", async (): Promise<void> => {
    const service = new SteamBridgeService();
    await service.checkAvailability();
    vi.mocked(invoke).mockClear();

    expect(await service.joinLobby("not-a-steamid")).toBe(false);
    expect(await service.createLobby("public", 251)).toBeNull();
    expect(await service.sendP2PPacket("76561198000000000", new Uint8Array(1), "reliable", 999)).toBe(false);
    expect(
      await service.sendP2PPacket(
        "76561198000000000",
        new Uint8Array(1_201),
        "unreliable",
        0,
      ),
    ).toBe(false);

    expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  });

  it("mantém o aplicativo funcional quando Steam está indisponível", async (): Promise<void> => {
    nativeState.online = false;
    const service = new SteamBridgeService();

    expect(await service.checkAvailability()).toBe(false);
    expect(service.isAvailable).toBe(false);
    expect(await service.getUser()).toBeNull();
    expect(await service.unlockAchievement("ACH_TEST")).toBe(false);
    expect(await service.createLobby("private", 2)).toBeNull();
    expect(await service.sendP2PPacket("76561198000000000", new Uint8Array([1]))).toBe(false);
  });
});
