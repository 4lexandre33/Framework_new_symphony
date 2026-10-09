import type { Plugin, PluginContext } from "@core";
import { SteamToken } from "../../tokens/steam";
import { UnlockAchievementCommand } from "../../contracts/steam/types";
import { CreateLobbyCommand, SendP2PPacketCommand, P2PMessageReceivedEvent, type SteamLobbyType, type P2PSendType } from "../../contracts/steam/net-types";
import { SteamBridgeService } from "../../engine/steam/internal/SteamBridgeService";

export const steamManifest: Plugin["manifest"] = {
  id: "game.steam",
  name: "Steamworks Integration Plugin",
  version: "1.1.0",
  kind: "preloaded",
  authority: "game",
  permissions: {
    capabilities: [SteamToken.id],
    events: ["game.steam.p2p-received"],
  },
  capabilities: {
    provides: [
      {
        id: SteamToken.id,
        version: "1.1.0",
      },
    ],
    conflicts: [],
  },
};

export function createSteamPlugin(): Plugin {
  return {
    manifest: steamManifest,

    setup(ctx: PluginContext) {
      const steamService = new SteamBridgeService();

      ctx.caps.provide(SteamToken, steamService);

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

      ctx.lifecycle.ready();
    },
  };
}
