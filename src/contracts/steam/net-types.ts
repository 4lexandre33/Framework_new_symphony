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