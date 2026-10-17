import { defineCapability } from "@core";
import type {
  P2PSendType,
  P2PSessionState,
  SteamLobbyType,
  SteamLobbyDetails,
  SteamLobbySearchOptions,
  SteamP2PPacket,
} from "../contracts/steam/net-types";

/**
 * Lobbies e sessões P2P da Steam. Fornecido pelo plugin `game.steam`
 * (consuma com `optional: true`: sem Steam `isAvailable` é `false` e todas as
 * operações resolvem `false`/`null`/`[]` sem lançar).
 *
 * Eventos relacionados: `game.steam.lobby-created`, `lobby-joined`,
 * `lobby-member-left`, `lobby-data-updated`, `lobby-invite`,
 * `p2p-session-request`, `p2p-session-failed`.
 */
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

  /** Busca lobbies públicos do jogo (filtros de metadata, vagas, distância). */
  searchLobbies(options?: SteamLobbySearchOptions): Promise<ReadonlyArray<SteamLobbyDetails>>;

  /** Dono, membros (contagem), limite e metadata atuais do lobby. */
  getLobbyDetails(lobbyId: string): Promise<SteamLobbyDetails | null>;

  /** SteamIDs dos membros (só disponível para lobbies em que o usuário está). */
  getLobbyMembers(lobbyId: string): Promise<ReadonlyArray<string>>;

  /** SteamID do dono do lobby. */
  getLobbyOwner(lobbyId: string): Promise<string | null>;

  /** Envia convite Steam para um amigo entrar no lobby. */
  inviteToLobby(lobbyId: string, inviteeSteamId: string): Promise<boolean>;

  /** Abre o diálogo de convite da Steam Overlay para o lobby. */
  openInviteDialog(lobbyId: string): Promise<boolean>;

  /** Permite/impede novas entradas no lobby. */
  setLobbyJoinable(lobbyId: string, joinable: boolean): Promise<boolean>;

  /** Lobbies criados/entrados por esta sessão e ainda não abandonados. */
  getJoinedLobbies(): ReadonlyArray<string>;

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

  /** Drena pacotes de todos os canais 0..255 numa única chamada (limitada). */
  readP2PPackets(maxPackets?: number): Promise<ReadonlyArray<SteamP2PPacket>>;

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
