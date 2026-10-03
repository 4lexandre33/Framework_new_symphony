import type { Plugin, PluginContext } from "../../core/contracts/plugin-context";
import { invoke } from "@tauri-apps/api/core";
import { SteamToken, type SteamApi, type SteamUser } from "../../tokens/steam";
import { BossDefeatedEvent, UnlockAchievementCommand } from "../../contracts/steam/types";
import {
  CreateLobbyCommand,
  SendP2PPacketCommand,
  P2PMessageReceivedEvent,
  type SteamLobbyType,
  type SteamLobbyDetails,
  type P2PSendType,
  type SteamP2PPacket,
} from "../../contracts/steam/net-types";

export const steamManifest: Plugin["manifest"] = {
  id: "game.steam",
  name: "Steamworks Integration Plugin",
  version: "1.1.0",
  kind: "preloaded",
  authority: "game",
  permissions: {
    capabilities: [SteamToken.id],
    events: ["game.boss-defeated", "game.steam.p2p-received"],
  },
  capabilities: {
    provides: [
      {
        id: SteamToken.id,
        version: "1.1.0",
      },
    ],
  },
};

export class SteamBridgeService implements SteamApi {
  private available = false;

  constructor() {
    this.checkAvailability();
  }

  get isAvailable(): boolean {
    return this.available;
  }

  public async checkAvailability(): Promise<boolean> {
    try {
      this.available = await invoke<boolean>("steam_is_initialized");
    } catch {
      this.available = false;
    }
    return this.available;
  }

  async getUser(): Promise<SteamUser | null> {
    if (!this.available) return null;
    try {
      const raw = await invoke<any>("steam_get_user");
      if (!raw) return null;

      return {
        steamId: raw.steamId || raw.steam_id || "",
        personaName: raw.personaName || raw.persona_name || "Jogador Steam",
        isOverlayEnabled: raw.isOverlayEnabled ?? raw.is_overlay_enabled ?? true,
      };
    } catch (err) {
      console.error("[SteamBridgeService] Erro ao obter dados do usuário Steam:", err);
      return null;
    }
  }

  async unlockAchievement(achievementId: string): Promise<boolean> {
    if (!this.available) return false;
    try {
      return await invoke<boolean>("steam_unlock_achievement", { achievementId });
    } catch {
      return false;
    }
  }

  async setStat(statName: string, value: number): Promise<boolean> {
    if (!this.available) return false;
    try {
      return await invoke<boolean>("steam_set_stat", { statName, value });
    } catch {
      return false;
    }
  }

  async storeStats(): Promise<boolean> {
    if (!this.available) return false;
    try {
      return await invoke<boolean>("steam_store_stats");
    } catch {
      return false;
    }
  }

  async createLobby(lobbyType: SteamLobbyType, maxMembers: number): Promise<SteamLobbyDetails | null> {
    if (!this.available) return null;
    try {
      const res = await invoke<any>("steam_create_lobby", { lobbyType, maxMembers });
      return {
        lobbyId: res.lobbyId,
        ownerSteamId: res.ownerSteamId,
        memberCount: res.memberCount,
        maxMembers: res.maxMembers,
        lobbyType,
        metadata: {},
      };
    } catch (err) {
      console.error("[SteamBridgeService] Erro ao criar lobby:", err);
      return null;
    }
  }

  async sendP2PPacket(
    targetSteamId: string,
    data: Uint8Array,
    sendType: P2PSendType = "unreliable",
    channel: number = 0
  ): Promise<boolean> {
    if (!this.available) return false;
    try {
      return await invoke<boolean>("steam_send_p2p_packet", {
        targetSteamId,
        data: Array.from(data),
        sendType,
        channel,
      });
    } catch (err) {
      console.error("[SteamBridgeService] Erro ao enviar pacote P2P:", err);
      return false;
    }
  }

  async readP2PPacket(channel: number = 0): Promise<SteamP2PPacket | null> {
    if (!this.available) return null;
    try {
      const res = await invoke<any>("steam_read_p2p_packet", { channel });
      if (!res) return null;
      return {
        sourceSteamId: res.sourceSteamId,
        channel: res.channel,
        data: new Uint8Array(res.data),
        bytesReceived: res.bytesReceived,
      };
    } catch (err) {
      console.error("[SteamBridgeService] Erro ao ler pacote P2P:", err);
      return null;
    }
  }
}

export function createSteamPlugin(): Plugin {
  return {
    manifest: steamManifest,

    setup(ctx: PluginContext) {
      const steamService = new SteamBridgeService();

      ctx.caps.provide(SteamToken, steamService);

      ctx.events.define(BossDefeatedEvent);
      ctx.events.define(P2PMessageReceivedEvent);
      ctx.commands.define(UnlockAchievementCommand);
      ctx.commands.define(CreateLobbyCommand);
      ctx.commands.define(SendP2PPacketCommand);

      ctx.commands.handle<"game.steam.unlock-achievement", { achievementId: string }>(
        UnlockAchievementCommand.type,
        async (env) => {
          const isOnline = await steamService.checkAvailability();
          if (!isOnline) return false;
          return await steamService.unlockAchievement(env.payload.achievementId);
        }
      );

      ctx.commands.handle<"game.steam.create-lobby", { lobbyType: SteamLobbyType; maxMembers: number }>(
        CreateLobbyCommand.type,
        async (env) => {
          const res = await steamService.createLobby(env.payload.lobbyType, env.payload.maxMembers);
          return !!res;
        }
      );

      ctx.commands.handle<"game.steam.send-p2p-packet", { targetSteamId: string; data: Uint8Array; sendType: P2PSendType; channel: number }>(
        SendP2PPacketCommand.type,
        async (env) => {
          return await steamService.sendP2PPacket(
            env.payload.targetSteamId,
            env.payload.data,
            env.payload.sendType,
            env.payload.channel
          );
        }
      );

      ctx.events.on<"game.boss-defeated", { bossId: string; noDamageTaken: boolean }>(
        BossDefeatedEvent.type,
        async (env) => {
          const isOnline = await steamService.checkAvailability();
          if (!isOnline) return;

          if (env.payload.bossId === "dragon_boss") {
            await steamService.unlockAchievement("ACH_KILL_DRAGON");
          }

          if (env.payload.noDamageTaken) {
            await steamService.unlockAchievement("ACH_PERFECT_BOSS");
          }

          await steamService.storeStats();
        }
      );

      ctx.lifecycle.ready();
    },
  };
}