import { defineCapability } from "@core";
import type {
  P2PSendType,
  SteamLobbyType,
  SteamLobbyDetails,
  SteamP2PPacket,
} from "../contracts/steam/net-types";

export interface SteamUser {
  readonly steamId: string;
  readonly personaName: string;
  readonly isOverlayEnabled: boolean;
}

export interface SteamApi {
  readonly isAvailable: boolean;

  checkAvailability(): Promise<boolean>;
  getUser(): Promise<SteamUser | null>;
  unlockAchievement(achievementId: string): Promise<boolean>;
  setStat(statName: string, value: number): Promise<boolean>;
  storeStats(): Promise<boolean>;

  createLobby(lobbyType: SteamLobbyType, maxMembers: number): Promise<SteamLobbyDetails | null>;
  sendP2PPacket(
    targetSteamId: string,
    data: Uint8Array,
    sendType?: P2PSendType,
    channel?: number
  ): Promise<boolean>;
  readP2PPacket(channel?: number): Promise<SteamP2PPacket | null>;
}

export const SteamToken = defineCapability<SteamApi>("game.steam", "1.0.0");