import { invoke } from "@tauri-apps/api/core";
import type { SteamApi, SteamUser } from "../../../tokens/steam";
import type { SteamNetworkApi } from "../../../tokens/steam-net";
import type {
  P2PSendType,
  P2PSessionState,
  SteamLobbyDetails,
  SteamLobbyType,
  SteamP2PPacket,
} from "../../../contracts/steam/net-types";

interface NativeSteamUserDto {
  readonly steamId: string;
  readonly personaName: string;
  readonly isOverlayEnabled: boolean;
}

interface NativeSteamLobbyDto {
  readonly lobbyId: string;
  readonly ownerSteamId: string;
  readonly memberCount: number;
  readonly maxMembers: number;
}

interface NativeSteamP2PPacketDto {
  readonly sourceSteamId: string;
  readonly channel: number;
  readonly data: readonly number[];
  readonly bytesReceived: number;
}

interface NativeSteamP2PSessionStateDto {
  readonly isConnectionActive: boolean;
  readonly isConnecting: boolean;
  readonly lastError: number;
  readonly usingRelay: boolean;
  readonly bytesQueuedForSend: number;
  readonly packetsQueuedForSend: number;
  readonly remoteSteamId: string;
}

const STEAM_ID_PATTERN = /^\d{1,20}$/u;
const MAX_LOBBY_MEMBERS = 250;
const MAX_P2P_CHANNEL = 255;
const MAX_UNRELIABLE_PACKET_BYTES = 1_200;
const MAX_RELIABLE_PACKET_BYTES = 1024 * 1024;

function isValidSteamId(value: string): boolean {
  return STEAM_ID_PATTERN.test(value);
}

function isValidChannel(channel: number): boolean {
  return Number.isInteger(channel) && channel >= 0 && channel <= MAX_P2P_CHANNEL;
}

function isValidLobbySize(maxMembers: number): boolean {
  return Number.isInteger(maxMembers) && maxMembers >= 1 && maxMembers <= MAX_LOBBY_MEMBERS;
}

function isValidPacketSize(sendType: P2PSendType, byteLength: number): boolean {
  const limit =
    sendType === "unreliable" || sendType === "unreliableNoDelay"
      ? MAX_UNRELIABLE_PACKET_BYTES
      : MAX_RELIABLE_PACKET_BYTES;

  return byteLength <= limit;
}

function isNonEmptyIdentifier(value: string): boolean {
  return value.length > 0 && value.length <= 128 && !value.includes("\0");
}

export class SteamBridgeService implements SteamApi, SteamNetworkApi {
  private available = false;

  public constructor() {
    void this.checkAvailability();
  }

  public get isAvailable(): boolean {
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

  private async ensureAvailable(): Promise<boolean> {
    if (this.available) {
      return true;
    }

    return this.checkAvailability();
  }

  public async getUser(): Promise<SteamUser | null> {
    if (!(await this.ensureAvailable())) {
      return null;
    }

    try {
      const raw = await invoke<NativeSteamUserDto>("steam_get_user");

      if (!isValidSteamId(raw.steamId) || raw.personaName.length === 0) {
        return null;
      }

      return {
        steamId: raw.steamId,
        personaName: raw.personaName,
        isOverlayEnabled: raw.isOverlayEnabled,
      };
    } catch {
      return null;
    }
  }

  public async unlockAchievement(achievementId: string): Promise<boolean> {
    if (!isNonEmptyIdentifier(achievementId) || !(await this.ensureAvailable())) {
      return false;
    }

    try {
      return await invoke<boolean>("steam_unlock_achievement", { achievementId });
    } catch {
      return false;
    }
  }

  public async setStat(statName: string, value: number): Promise<boolean> {
    if (
      !isNonEmptyIdentifier(statName) ||
      !Number.isFinite(value) ||
      !(await this.ensureAvailable())
    ) {
      return false;
    }

    const normalizedValue = Math.trunc(value);
    if (normalizedValue < -2_147_483_648 || normalizedValue > 2_147_483_647) {
      return false;
    }

    try {
      return await invoke<boolean>("steam_set_stat", {
        statName,
        value: normalizedValue,
      });
    } catch {
      return false;
    }
  }

  public async storeStats(): Promise<boolean> {
    if (!(await this.ensureAvailable())) {
      return false;
    }

    try {
      return await invoke<boolean>("steam_store_stats");
    } catch {
      return false;
    }
  }

  public async createLobby(
    lobbyType: SteamLobbyType,
    maxMembers: number,
  ): Promise<SteamLobbyDetails | null> {
    if (!isValidLobbySize(maxMembers) || !(await this.ensureAvailable())) {
      return null;
    }

    try {
      const result = await invoke<NativeSteamLobbyDto>("steam_create_lobby", {
        lobbyType,
        maxMembers,
      });

      if (!isValidSteamId(result.lobbyId) || !isValidSteamId(result.ownerSteamId)) {
        return null;
      }

      return {
        lobbyId: result.lobbyId,
        ownerSteamId: result.ownerSteamId,
        memberCount: result.memberCount,
        maxMembers: result.maxMembers,
        lobbyType,
        metadata: {},
      };
    } catch {
      return null;
    }
  }

  public async joinLobby(lobbyId: string): Promise<boolean> {
    if (!isValidSteamId(lobbyId) || !(await this.ensureAvailable())) {
      return false;
    }

    try {
      return await invoke<boolean>("steam_join_lobby", { lobbyId });
    } catch {
      return false;
    }
  }

  public async leaveLobby(lobbyId: string): Promise<boolean> {
    if (!isValidSteamId(lobbyId) || !(await this.ensureAvailable())) {
      return false;
    }

    try {
      return await invoke<boolean>("steam_leave_lobby", { lobbyId });
    } catch {
      return false;
    }
  }

  public async setLobbyData(lobbyId: string, key: string, value: string): Promise<boolean> {
    if (
      !isValidSteamId(lobbyId) ||
      key.length === 0 ||
      key.length > 255 ||
      value.length > 8 * 1024 ||
      key.includes("\0") ||
      value.includes("\0") ||
      !(await this.ensureAvailable())
    ) {
      return false;
    }

    try {
      return await invoke<boolean>("steam_set_lobby_data", {
        lobbyId,
        key,
        value,
      });
    } catch {
      return false;
    }
  }

  public async getLobbyData(lobbyId: string, key: string): Promise<string | null> {
    if (
      !isValidSteamId(lobbyId) ||
      key.length === 0 ||
      key.length > 255 ||
      key.includes("\0") ||
      !(await this.ensureAvailable())
    ) {
      return null;
    }

    try {
      return await invoke<string | null>("steam_get_lobby_data", { lobbyId, key });
    } catch {
      return null;
    }
  }

  public async sendP2PPacket(
    targetSteamId: string,
    data: Uint8Array,
    sendType: P2PSendType = "unreliable",
    channel = 0,
  ): Promise<boolean> {
    if (
      !isValidSteamId(targetSteamId) ||
      !isValidChannel(channel) ||
      !isValidPacketSize(sendType, data.byteLength) ||
      !(await this.ensureAvailable())
    ) {
      return false;
    }

    try {
      return await invoke<boolean>("steam_send_p2p_packet", {
        targetSteamId,
        data: Array.from(data),
        sendType,
        channel,
      });
    } catch {
      return false;
    }
  }

  public async readP2PPacket(channel = 0): Promise<SteamP2PPacket | null> {
    if (!isValidChannel(channel) || !(await this.ensureAvailable())) {
      return null;
    }

    try {
      const result = await invoke<NativeSteamP2PPacketDto | null>("steam_read_p2p_packet", {
        channel,
      });

      if (result === null || !isValidSteamId(result.sourceSteamId)) {
        return null;
      }

      const data = Uint8Array.from(result.data);
      if (result.bytesReceived !== data.byteLength) {
        return null;
      }

      return {
        sourceSteamId: result.sourceSteamId,
        channel: result.channel,
        data,
        bytesReceived: result.bytesReceived,
      };
    } catch {
      return null;
    }
  }

  public async acceptP2PSession(remoteSteamId: string): Promise<boolean> {
    if (!isValidSteamId(remoteSteamId) || !(await this.ensureAvailable())) {
      return false;
    }

    try {
      return await invoke<boolean>("steam_accept_p2p_session", { remoteSteamId });
    } catch {
      return false;
    }
  }

  public async closeP2PSession(remoteSteamId: string): Promise<boolean> {
    if (!isValidSteamId(remoteSteamId) || !(await this.ensureAvailable())) {
      return false;
    }

    try {
      return await invoke<boolean>("steam_close_p2p_session", { remoteSteamId });
    } catch {
      return false;
    }
  }

  public async getP2PSessionState(remoteSteamId: string): Promise<P2PSessionState | null> {
    if (!isValidSteamId(remoteSteamId) || !(await this.ensureAvailable())) {
      return null;
    }

    try {
      const result = await invoke<NativeSteamP2PSessionStateDto | null>(
        "steam_get_p2p_session_state",
        { remoteSteamId },
      );

      if (result === null || result.remoteSteamId !== remoteSteamId) {
        return null;
      }

      return {
        isConnectionActive: result.isConnectionActive,
        isConnecting: result.isConnecting,
        lastError: result.lastError,
        usingRelay: result.usingRelay,
        bytesQueuedForSend: result.bytesQueuedForSend,
        packetsQueuedForSend: result.packetsQueuedForSend,
        remoteSteamId: result.remoteSteamId,
      };
    } catch {
      return null;
    }
  }
}
