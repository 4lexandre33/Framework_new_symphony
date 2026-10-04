import { defineCapability } from "@core";
import type {
  P2PSendType,
  P2PSessionState,
  SteamLobbyType,
  SteamLobbyDetails,
  SteamP2PPacket,
} from "../contracts/steam/net-types";

export interface SteamNetworkApi {
  readonly isAvailable: boolean;

  /**
   * Cria um novo Lobby na Steam com o tipo de visibilidade e limite de jogadores informados.
   */
  createLobby(lobbyType: SteamLobbyType, maxMembers: number): Promise<SteamLobbyDetails | null>;

  /**
   * Entra em um Lobby existente na Steam a partir de seu ID único de 64 bits.
   */
  joinLobby(lobbyId: string): Promise<boolean>;

  /**
   * Abandona o Lobby informado.
   */
  leaveLobby(lobbyId: string): Promise<boolean>;

  /**
   * Define uma chave/valor de metadados no Lobby (ex: nome do mapa, modo de jogo).
   */
  setLobbyData(lobbyId: string, key: string, value: string): Promise<boolean>;

  /**
   * Recupera o valor de uma chave de metadados do Lobby.
   */
  getLobbyData(lobbyId: string, key: string): Promise<string | null>;

  /**
   * Envia um pacote de dados P2P de alta velocidade diretamente para outro jogador via Steam.
   */
  sendP2PPacket(
    targetSteamId: string,
    data: Uint8Array,
    sendType?: P2PSendType,
    channel?: number
  ): Promise<boolean>;

  /**
   * Lê o próximo pacote P2P pendente da fila do canal informado.
   */
  readP2PPacket(channel?: number): Promise<SteamP2PPacket | null>;

  /**
   * Aceita uma solicitação de sessão P2P vinda de um jogador remoto.
   */
  acceptP2PSession(remoteSteamId: string): Promise<boolean>;

  /**
   * Encerra a sessão P2P ativa com o jogador remoto.
   */
  closeP2PSession(remoteSteamId: string): Promise<boolean>;

  /**
   * Retorna o estado técnico da conexão P2P (latência, perda de pacotes, uso de relay).
   */
  getP2PSessionState(remoteSteamId: string): Promise<P2PSessionState | null>;
}

export const SteamNetworkToken = defineCapability<SteamNetworkApi>(
  "game.steam.net",
  "1.0.0"
);