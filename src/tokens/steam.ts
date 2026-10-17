import { defineCapability } from "@core";
import type {
  P2PSendType,
  SteamLobbyType,
  SteamLobbyDetails,
  SteamP2PPacket,
} from "../contracts/steam/net-types";
import type { SetStatOptions, SteamStatType } from "../contracts/steam/types";

export interface SteamUser {
  readonly steamId: string;
  readonly personaName: string;
  readonly isOverlayEnabled: boolean;
}

export interface SteamApi {
  /**
   * `true` quando a Steam está inicializada. Resolvido no boot do plugin
   * `game.steam` (evento `game.steam.availability-changed`); antes disso use
   * `await checkAvailability()`.
   */
  readonly isAvailable: boolean;

  /** `true` depois que as stats/conquistas do usuário chegaram (evento `game.steam.stats-ready`). */
  readonly statsReady?: boolean;

  checkAvailability(): Promise<boolean>;
  getUser(): Promise<SteamUser | null>;
  /**
   * Libera a conquista. Se as stats ainda não chegaram, aguarda até
   * `game.steam.stats-ready` (com timeout) antes de tentar.
   */
  unlockAchievement(achievementId: string): Promise<boolean>;
  /**
   * Define uma estatística. `int` (padrão) exige inteiro de 32 bits (não
   * trunca: valor não inteiro resolve `false`); `{ type: "float" }` usa
   * stat float. Aguarda as stats chegarem (com timeout). Persistir na Steam
   * exige `storeStats()`.
   */
  setStat(statName: string, value: number, options?: SetStatOptions): Promise<boolean>;
  /** Lê uma estatística; `null` sem Steam/stats ou stat inexistente. */
  getStat?(statName: string, type?: SteamStatType): Promise<number | null>;
  storeStats(): Promise<boolean>;

  createLobby(lobbyType: SteamLobbyType, maxMembers: number): Promise<SteamLobbyDetails | null>;
  sendP2PPacket(
    targetSteamId: string,
    data: Uint8Array,
    sendType?: P2PSendType,
    channel?: number
  ): Promise<boolean>;
  readP2PPacket(channel?: number): Promise<SteamP2PPacket | null>;
  /**
   * Drena pacotes de TODOS os canais 0..255 numa única chamada (limitada).
   * Opcional para compatibilidade com implementações antigas.
   */
  readP2PPackets?(maxPackets?: number): Promise<ReadonlyArray<SteamP2PPacket>>;
}

export const SteamToken = defineCapability<SteamApi>("game.steam", "1.0.0");
