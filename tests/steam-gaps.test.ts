// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { PluginContext } from "@core";

import { SteamBridgeService } from "../src/engine/steam/internal/SteamBridgeService";
import { createSteamPlugin, forwardSteamNativeEvent, steamManifest } from "../src/plugins/steam/plugin";
import { SteamToken } from "../src/tokens/steam";
import { SteamNetworkToken } from "../src/tokens/steam-net";

const native = vi.hoisted(() => ({
  online: true,
  statsReady: true,
  events: [] as unknown[],
  calls: [] as Array<{ command: string; args?: Record<string, unknown> }>,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string, args?: Record<string, unknown>): Promise<unknown> => {
    native.calls.push({ command, args });
    if (command === "steam_is_initialized") return native.online;
    if (!native.online) throw new Error("Steam indisponível");

    switch (command) {
      case "steam_poll_events": {
        const drained = native.events.splice(0, Number(args?.maxEvents ?? 128));
        return drained;
      }
      case "steam_get_user":
        return { steamId: "76561198000000001", personaName: "Local", isOverlayEnabled: true };
      case "steam_set_stat":
      case "steam_set_stat_float":
      case "steam_unlock_achievement":
        if (!native.statsReady) throw "STATS_NOT_READY: stats da Steam ainda não foram recebidas";
        return true;
      case "steam_get_stat":
        return args?.kind === "float" ? 1.5 : 7;
      case "steam_request_lobby_list":
        return [
          {
            lobbyId: "109775241000000001",
            ownerSteamId: "76561198000000009",
            memberCount: 2,
            maxMembers: 4,
            metadata: { mode: "coop" },
          },
          { lobbyId: "invalid", ownerSteamId: "x", memberCount: 0, maxMembers: 0 },
        ];
      case "steam_get_lobby_details":
        return {
          lobbyId: args?.lobbyId,
          ownerSteamId: "76561198000000009",
          memberCount: 2,
          maxMembers: 4,
          metadata: { map: "arena" },
        };
      case "steam_get_lobby_members":
        return ["76561198000000009", "76561198000000001", "bogus"];
      case "steam_invite_to_lobby":
      case "steam_activate_invite_dialog":
      case "steam_set_lobby_joinable":
      case "steam_join_lobby":
      case "steam_leave_lobby":
      case "steam_accept_p2p_session":
        return true;
      case "steam_read_p2p_packets":
        return {
          packets: [
            { sourceSteamId: "76561198000000009", channel: 0, data: [1, 2], bytesReceived: 2 },
            { sourceSteamId: "76561198000000009", channel: 200, data: [3], bytesReceived: 1 },
            { sourceSteamId: "76561198000000009", channel: 3, data: [3], bytesReceived: 9 },
          ],
          droppedOversized: 2,
        };
      default:
        return null;
    }
  }),
}));

interface FakeCtx {
  readonly ctx: PluginContext;
  readonly emitted: Array<{ type: string; payload: unknown }>;
  readonly provided: Map<string, unknown>;
  readonly commands: Map<string, (env: { payload: unknown }) => unknown>;
  readonly disposers: Array<() => void | Promise<void>>;
}

function fakeCtx(): FakeCtx {
  const emitted: Array<{ type: string; payload: unknown }> = [];
  const provided = new Map<string, unknown>();
  const commands = new Map<string, (env: { payload: unknown }) => unknown>();
  const disposers: Array<() => void | Promise<void>> = [];
  const ctx = {
    id: "game.steam",
    log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
    events: {
      emit: (type: string, payload: unknown) => emitted.push({ type, payload }),
      define: vi.fn(),
      on: vi.fn(() => () => {}),
    },
    commands: {
      define: vi.fn(),
      handle: (type: string, handler: (env: { payload: unknown }) => unknown) => {
        commands.set(type, handler);
        return () => commands.delete(type);
      },
    },
    caps: {
      provide: (token: { id: string }, value: unknown) => provided.set(token.id, value),
    },
    lifecycle: {
      onDispose: (fn: () => void | Promise<void>) => disposers.push(fn),
      ready: vi.fn(),
    },
  } as unknown as PluginContext;
  return { ctx, emitted, provided, commands, disposers };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe("steam gaps", () => {
  beforeEach(() => {
    native.online = true;
    native.statsReady = true;
    native.events = [];
    native.calls = [];
    vi.mocked(invoke).mockClear();
  });

  it("G109: game.steam fornece game.steam.net com implementação real (mesmo bridge)", async () => {
    const provides = steamManifest.capabilities?.provides?.map((entry) => entry.id) ?? [];
    expect(provides).toContain(SteamNetworkToken.id);
    expect(steamManifest.permissions?.capabilities).toContain(SteamNetworkToken.id);

    const fake = fakeCtx();
    const service = new SteamBridgeService();
    await service.checkAvailability();
    createSteamPlugin({ service }).setup(fake.ctx);

    expect(fake.provided.get(SteamToken.id)).toBe(service);
    expect(fake.provided.get(SteamNetworkToken.id)).toBe(service);
    for (const dispose of fake.disposers) await dispose();
  });

  it("G109: sem Steam o token degrada para indisponível sem lançar", async () => {
    native.online = false;
    const service = new SteamBridgeService();
    expect(await service.checkAvailability()).toBe(false);
    expect(await service.joinLobby("109775241000000001")).toBe(false);
    expect(await service.searchLobbies()).toEqual([]);
    expect(await service.getLobbyMembers("109775241000000001")).toEqual([]);
    expect(await service.getLobbyOwner("109775241000000001")).toBeNull();
    expect(await service.readP2PPackets()).toEqual([]);
    expect(await service.pollEvents()).toEqual([]);
    expect(await service.setStat("STAT", 1.5, { type: "float" })).toBe(false);
  });

  it("G26: busca, detalhes, membros, dono e convites", async () => {
    const service = new SteamBridgeService();
    await service.checkAvailability();

    const lobbies = await service.searchLobbies({
      stringFilters: [{ key: "mode", value: "coop" }],
      slotsAvailable: 1,
      distance: "worldwide",
      maxResults: 10,
    });
    expect(lobbies).toHaveLength(1);
    expect(lobbies[0]).toMatchObject({ lobbyId: "109775241000000001", metadata: { mode: "coop" }, lobbyType: "public" });
    expect(native.calls.find((c) => c.command === "steam_request_lobby_list")?.args).toEqual({
      search: {
        stringFilters: [{ key: "mode", value: "coop", comparison: "equal" }],
        numberFilters: [],
        slotsAvailable: 1,
        distance: "worldwide",
        maxResults: 10,
      },
    });

    native.calls = [];
    expect(await service.searchLobbies({ maxResults: 99 })).toEqual([]);
    expect(await service.searchLobbies({ stringFilters: [{ key: "a\0", value: "b" }] })).toEqual([]);
    expect(native.calls.some((c) => c.command === "steam_request_lobby_list")).toBe(false);

    expect(await service.getLobbyMembers("109775241000000001")).toEqual(["76561198000000009", "76561198000000001"]);
    expect(await service.getLobbyOwner("109775241000000001")).toBe("76561198000000009");
    expect((await service.getLobbyDetails("109775241000000001"))?.metadata).toEqual({ map: "arena" });
    expect(await service.inviteToLobby("109775241000000001", "76561198000000002")).toBe(true);
    expect(await service.inviteToLobby("109775241000000001", "nope")).toBe(false);
    expect(await service.openInviteDialog("109775241000000001")).toBe(true);
    expect(await service.setLobbyJoinable("109775241000000001", false)).toBe(true);
    expect(await service.joinLobby("109775241000000001")).toBe(true);
    expect(service.getJoinedLobbies()).toEqual(["109775241000000001"]);
    expect(await service.leaveLobby("109775241000000001")).toBe(true);
    expect(service.getJoinedLobbies()).toEqual([]);
  });

  it("G110: eventos nativos viram game.steam.* e comandos join/leave/accept são tratados", async () => {
    const fake = fakeCtx();
    const service = new SteamBridgeService();
    await service.checkAvailability();
    createSteamPlugin({ service, eventPumpIntervalMs: 10_000 }).setup(fake.ctx);

    native.events.push(
      { kind: "p2pSessionRequest", remoteSteamId: "76561198000000009" },
      { kind: "p2pSessionConnectFail", remoteSteamId: "76561198000000009", error: 3 },
      { kind: "lobbyChatUpdate", lobbyId: "1", userSteamId: "2", makingChangeSteamId: "2", change: "entered" },
      { kind: "lobbyChatUpdate", lobbyId: "1", userSteamId: "3", makingChangeSteamId: "3", change: "disconnected" },
      { kind: "lobbyDataUpdate", lobbyId: "1", memberSteamId: "1", success: true },
      { kind: "lobbyJoinRequested", lobbyId: "1", friendSteamId: "5" },
      { kind: "userStatsReceived", steamId: "76561198000000001", success: true, error: null },
      { kind: "microTxnAuthorization", appId: 480, orderId: "99", authorized: true },
      { kind: "workshopDownloadResult", publishedFileId: "42", success: false, error: "Timeout" },
      { kind: "bogus" },
    );

    await service.pollEvents();
    await flush();

    const types = fake.emitted.map((entry) => entry.type);
    expect(types).toEqual(
      expect.arrayContaining([
        "game.steam.availability-changed",
        "game.steam.p2p-session-request",
        "game.steam.p2p-session-failed",
        "game.steam.lobby-joined",
        "game.steam.lobby-member-left",
        "game.steam.lobby-data-updated",
        "game.steam.lobby-invite",
        "game.steam.stats-ready",
        "game.steam.microtxn-authorization",
        "game.steam.workshop-download-result",
      ]),
    );
    expect(service.statsReady).toBe(true);
    for (const type of types) {
      expect(steamManifest.permissions?.events).toContain(type);
    }

    expect(await fake.commands.get("game.steam.join-lobby")?.({ payload: { lobbyId: "109775241000000001" } })).toBe(true);
    expect(await fake.commands.get("game.steam.leave-lobby")?.({ payload: { lobbyId: "109775241000000001" } })).toBe(true);
    expect(
      await fake.commands.get("game.steam.accept-p2p-session")?.({ payload: { remoteSteamId: "76561198000000009" } }),
    ).toBe(true);
    expect(await fake.commands.get("game.steam.create-lobby")?.({ payload: { lobbyType: "public", maxMembers: 999 } })).toBeNull(); // G29: devolve os detalhes ou null
    expect(fake.emitted.some((e) => e.type === "game.steam.lobby-created" && (e.payload as { isSuccess: boolean }).isSuccess === false)).toBe(true);

    // pacote lido por qualquer consumidor também sai como game.steam.p2p-received
    await service.readP2PPackets();
    expect(fake.emitted.filter((e) => e.type === "game.steam.p2p-received")).toHaveLength(2);

    for (const dispose of fake.disposers) await dispose();
  });

  it("G110: forwardSteamNativeEvent ignora tipos desconhecidos e loga transbordo", () => {
    const fake = fakeCtx();
    forwardSteamNativeEvent(fake.ctx, { kind: "eventsDropped", count: 3 });
    forwardSteamNativeEvent(fake.ctx, { kind: "steamServersConnected" });
    expect(fake.emitted).toHaveLength(0);
  });

  it("G104/G111: leitura em lote de todos os canais filtra pacotes corrompidos e conta descartes", async () => {
    const service = new SteamBridgeService();
    await service.checkAvailability();
    const packets = await service.readP2PPackets(600);
    expect(packets.map((p) => p.channel)).toEqual([0, 200]);
    expect(service.droppedOversizedPacketCount).toBe(2);
    const args = native.calls.find((c) => c.command === "steam_read_p2p_packets")?.args;
    expect(args?.maxPackets).toBe(512);
  });

  it("G112: stat float, int sem truncar, leitura e espera pelas stats", async () => {
    const service = new SteamBridgeService({ statsReadyTimeoutMs: 1_000 });
    await service.checkAvailability();

    expect(await service.setStat("DIST", 12.75, { type: "float" })).toBe(true);
    expect(native.calls.some((c) => c.command === "steam_set_stat_float" && c.args?.value === 12.75)).toBe(true);
    native.calls = [];
    expect(await service.setStat("KILLS", 1.5)).toBe(false);
    expect(await service.setStat("KILLS", Number.NaN)).toBe(false);
    expect(native.calls.some((c) => c.command === "steam_set_stat")).toBe(false);
    expect(await service.getStat("DIST", "float")).toBe(1.5);
    expect(await service.getStat("KILLS")).toBe(7);

    native.statsReady = false;
    const pending = service.setStat("KILLS", 3);
    await flush();
    native.statsReady = true;
    service.handleNativeEvent({ kind: "userStatsReceived", steamId: "76561198000000001", success: true });
    expect(await pending).toBe(true);

    native.statsReady = false;
    const timedOut = new SteamBridgeService({ statsReadyTimeoutMs: 5 });
    await timedOut.checkAvailability();
    expect(await timedOut.unlockAchievement("ACH")).toBe(false);
  });

  it("G112: disponibilidade resolvida cedo com evento", async () => {
    const fake = fakeCtx();
    const service = new SteamBridgeService();
    const plugin = createSteamPlugin({ service, eventPumpIntervalMs: 10_000 });
    plugin.setup(fake.ctx);
    await plugin.manifest.lifecycleHooks?.onBoot?.(fake.ctx);
    expect(service.isAvailable).toBe(true);
    const availability = fake.emitted.filter((e) => e.type === "game.steam.availability-changed");
    expect(availability.length).toBeGreaterThanOrEqual(1);
    expect(availability[0]?.payload).toEqual({ isAvailable: true });
    for (const dispose of fake.disposers) await dispose();
    expect(service.isAvailable).toBe(false);
  });
});
