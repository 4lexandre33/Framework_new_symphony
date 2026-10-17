import { defineEvent, defineCommand } from "@core";

/**
 * Modos de envio de pacotes P2P da Steamworks API (equivalente a P2PSend da Valve).
 */
export type P2PSendType =
  | "unreliable"
  | "unreliableNoDelay"
  | "reliable"
  | "reliableWithBuffering";

/**
 * Visibilidade e tipo do Lobby multiplayer na infraestrutura da Steam.
 */
export type SteamLobbyType =
  | "private"
  | "friendsOnly"
  | "public"
  | "invisible";

/**
 * Estrutura de dados detalhada de um Lobby da Steam.
 */
export interface SteamLobbyDetails {
  readonly lobbyId: string;
  readonly ownerSteamId: string;
  readonly memberCount: number;
  readonly maxMembers: number;
  readonly lobbyType: SteamLobbyType;
  readonly metadata: Readonly<Record<string, string>>;
}

/**
 * Estado da conexão de uma sessão P2P individual entre o jogador local e um par remoto.
 */
export interface P2PSessionState {
  readonly isConnectionActive: boolean;
  readonly isConnecting: boolean;
  readonly lastError: number;
  readonly usingRelay: boolean;
  readonly bytesQueuedForSend: number;
  readonly packetsQueuedForSend: number;
  readonly remoteSteamId: string;
}

/**
 * Pacote bruto de dados recebido ou enviado via rede P2P da Steam.
 */
export interface SteamP2PPacket {
  readonly sourceSteamId: string;
  readonly channel: number;
  readonly data: Uint8Array;
  readonly bytesReceived: number;
}

// ── EVENTOS DE REDE P2P & LOBBY ──────────────────────────────────────────

export interface P2PMessageReceivedPayload {
  readonly sourceSteamId: string;
  readonly channel: number;
  readonly data: Uint8Array;
  readonly bytesReceived: number;
}

export const P2PMessageReceivedEvent = defineEvent<
  "game.steam.p2p-received",
  P2PMessageReceivedPayload
>("game.steam.p2p-received");

export interface P2PSessionRequestPayload {
  readonly remoteSteamId: string;
}

export const P2PSessionRequestEvent = defineEvent<
  "game.steam.p2p-session-request",
  P2PSessionRequestPayload
>("game.steam.p2p-session-request");

export interface LobbyCreatedPayload {
  readonly lobbyId: string;
  readonly isSuccess: boolean;
  readonly error?: string;
}

export const LobbyCreatedEvent = defineEvent<
  "game.steam.lobby-created",
  LobbyCreatedPayload
>("game.steam.lobby-created");

export interface LobbyJoinedPayload {
  readonly lobbyId: string;
  readonly memberSteamId: string;
}

export const LobbyJoinedEvent = defineEvent<
  "game.steam.lobby-joined",
  LobbyJoinedPayload
>("game.steam.lobby-joined");

export interface LobbyMemberLeftPayload {
  readonly lobbyId: string;
  readonly memberSteamId: string;
}

export const LobbyMemberLeftEvent = defineEvent<
  "game.steam.lobby-member-left",
  LobbyMemberLeftPayload
>("game.steam.lobby-member-left");

// ── COMANDOS DE REDE P2P & LOBBY ─────────────────────────────────────────

export interface CreateLobbyRequest {
  readonly lobbyType: SteamLobbyType;
  readonly maxMembers: number;
}

export const CreateLobbyCommand = defineCommand<
  "game.steam.create-lobby",
  CreateLobbyRequest
>("game.steam.create-lobby");

export interface JoinLobbyRequest {
  readonly lobbyId: string;
}

export const JoinLobbyCommand = defineCommand<
  "game.steam.join-lobby",
  JoinLobbyRequest
>("game.steam.join-lobby");

export interface LeaveLobbyRequest {
  readonly lobbyId: string;
}

export const LeaveLobbyCommand = defineCommand<
  "game.steam.leave-lobby",
  LeaveLobbyRequest
>("game.steam.leave-lobby");

export interface SendP2PPacketRequest {
  readonly targetSteamId: string;
  readonly data: Uint8Array;
  readonly sendType: P2PSendType;
  readonly channel: number;
}

export const SendP2PPacketCommand = defineCommand<
  "game.steam.send-p2p-packet",
  SendP2PPacketRequest
>("game.steam.send-p2p-packet");

export interface AcceptP2PSessionRequest {
  readonly remoteSteamId: string;
}

export const AcceptP2PSessionCommand = defineCommand<
  "game.steam.accept-p2p-session",
  AcceptP2PSessionRequest
>("game.steam.accept-p2p-session");

// ── BUSCA DE LOBBY (G26) ─────────────────────────────────────────────────

export type SteamLobbyComparison =
  | "equal"
  | "notEqual"
  | "greaterThan"
  | "greaterThanOrEqual"
  | "lessThan"
  | "lessThanOrEqual";

export type SteamLobbyDistance = "close" | "default" | "far" | "worldwide";

export interface SteamLobbySearchOptions {
  /** Filtros de metadata string (apenas `equal`/`notEqual`). Máx. 16 filtros no total. */
  readonly stringFilters?: ReadonlyArray<{
    readonly key: string;
    readonly value: string;
    readonly comparison?: "equal" | "notEqual";
  }>;
  /** Filtros numéricos sobre metadata (inteiro de 32 bits). */
  readonly numberFilters?: ReadonlyArray<{
    readonly key: string;
    readonly value: number;
    readonly comparison?: SteamLobbyComparison;
  }>;
  readonly slotsAvailable?: number;
  readonly distance?: SteamLobbyDistance;
  /** 1..50 (padrão 50). */
  readonly maxResults?: number;
}

// ── EVENTOS ADICIONAIS (G110) ────────────────────────────────────────────

export interface LobbyDataUpdatedPayload {
  readonly lobbyId: string;
  /** Igual a `lobbyId` quando mudou a metadata do lobby; SteamID quando foi a de um membro. */
  readonly memberSteamId: string;
  readonly success: boolean;
}

export const LobbyDataUpdatedEvent = defineEvent<
  "game.steam.lobby-data-updated",
  LobbyDataUpdatedPayload
>("game.steam.lobby-data-updated");

export interface LobbyInviteReceivedPayload {
  /** Lobby em que o jogador pediu para entrar pela Steam (convite / "Entrar no jogo"). */
  readonly lobbyId: string;
  readonly friendSteamId: string;
}

export const LobbyInviteReceivedEvent = defineEvent<
  "game.steam.lobby-invite",
  LobbyInviteReceivedPayload
>("game.steam.lobby-invite");

export interface P2PSessionFailedPayload {
  readonly remoteSteamId: string;
  /** EP2PSessionError da Steam. */
  readonly error: number;
}

export const P2PSessionFailedEvent = defineEvent<
  "game.steam.p2p-session-failed",
  P2PSessionFailedPayload
>("game.steam.p2p-session-failed");