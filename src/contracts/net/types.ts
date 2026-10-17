import { defineEvent, defineCommand } from "@core";

/**
 * - `steam_p2p`: Steam (Tauri + Steam ativa);
 * - `websocket`: cliente de um servidor/relay que fala o protocolo do game.net (não hospeda);
 * - `mock`: loopback em memória (mesmo runtime: multiplayer local e testes) — `loopback://<sala>`;
 * - `broadcast_channel`: abas/janelas da mesma origem — `bc://<sala>`;
 * - `webrtc`: reservado (não implementado; selecioná-lo falha).
 */
export type TransportType = "steam_p2p" | "websocket" | "webrtc" | "mock" | "broadcast_channel";

export type NetMode = "host" | "client" | "offline";

export interface NetVector3 {
  x: number;
  y: number;
  z: number;
}

export interface NetQuaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface EntitySnapshot {
  readonly entityId: string;
  readonly type: string;
  readonly position: NetVector3;
  readonly rotation: NetQuaternion;
  readonly velocity: NetVector3;
  readonly sequence: number;
  readonly timestamp: number;
}

export interface WorldStateSnapshot {
  readonly sequence: number;
  readonly timestamp: number;
  readonly tick: number;
  readonly hostSteamId: string;
  readonly entities: ReadonlyArray<EntitySnapshot>;
}

export interface StateReplicationApi {
  registerEntity(entityId: string, initialSnapshot: EntitySnapshot): void;
  unregisterEntity(entityId: string): void;
  pushEntitySnapshot(snapshot: EntitySnapshot): void;
  /**
   * Aplica um snapshot de mundo vindo de `sourcePeerId` (padrão:
   * `worldSnapshot.hostSteamId`): cria/atualiza as entidades dele e REMOVE as
   * entidades dessa mesma origem que sumiram do snapshot. Entidades locais
   * (registradas pelo jogo) nunca são removidas nem sobrescritas por snapshots
   * remotos. Snapshot mais antigo que o último da mesma origem é ignorado.
   */
  processWorldSnapshot(worldSnapshot: WorldStateSnapshot, sourcePeerId?: string): void;
  getInterpolatedState(entityId: string, alpha: number): EntitySnapshot | null;
  generateWorldSnapshot(sequence: number, tick: number, hostSteamId: string): WorldStateSnapshot;
  clear(): void;
}

export interface NetPacketHeader {
  readonly magic: number;
  readonly packetType: number;
  readonly sequence: number;
  readonly channel: number;
  readonly senderId: string;
  readonly timestamp: number;
}

export interface NetPacket {
  readonly header: NetPacketHeader;
  readonly payload: Uint8Array;
}

export interface NetworkStats {
  /** RTT médio medido por ping/pong da sessão (0 sem pares/medição). */
  readonly rttMs: number;
  /** Fração 0..1 de pings sem resposta na janela recente (perda real). */
  readonly packetLossRate: number;
  readonly bytesSentPerSec: number;
  readonly bytesReceivedPerSec: number;
  readonly activeConnections: number;
  readonly transportType: TransportType;
}

export interface NetHostOptions {
  /** Sala do loopback/BroadcastChannel (padrão: `room` ou 7777). Steam não usa portas. 1..65535. */
  readonly port?: number;
  /** Limite de clientes aceitos no handshake (1..250, padrão 16). */
  readonly maxClients?: number;
  /** Transporte explícito; padrão: Steam se disponível, senão `mock` (loopback). */
  readonly transport?: TransportType;
  /** Nome da sala (loopback/BroadcastChannel): `[A-Za-z0-9_.-]{1,64}`. */
  readonly room?: string;
}

export interface NetSessionOptions {
  /** Intervalo de ping (padrão 1000 ms). */
  readonly heartbeatIntervalMs?: number;
  /** Par sem tráfego por este tempo é desconectado (padrão 5000 ms). */
  readonly peerTimeoutMs?: number;
  /** Tempo máximo para o WELCOME do host no `connect` (padrão 5000 ms). */
  readonly handshakeTimeoutMs?: number;
}

export interface AutoSnapshotOptions {
  readonly enabled: boolean;
  /** Envia a cada N ticks do game loop (padrão 3). */
  readonly intervalTicks?: number;
  /** Snapshot confiável (padrão false; acima do MTU usa confiável fragmentado). */
  readonly reliable?: boolean;
}

export interface NetPeerInfo {
  readonly peerId: string;
  /** RTT suavizado; `null` antes do primeiro pong. */
  readonly rttMs: number | null;
  readonly packetLossRate: number;
  readonly lastHeardMs: number;
}

// ── EVENTOS DE REDE ────────────────────────────────────────────────────────

export interface NetPacketReceivedPayload {
  readonly senderId: string;
  readonly channel: number;
  readonly data: Uint8Array;
}

export const NetPacketReceivedEvent = defineEvent<
  "game.net.packet-received",
  NetPacketReceivedPayload
>("game.net.packet-received");

export interface PeerConnectedPayload {
  readonly peerId: string;
  readonly transport: TransportType;
}

export const PeerConnectedEvent = defineEvent<
  "game.net.peer-connected",
  PeerConnectedPayload
>("game.net.peer-connected");

export interface PeerDisconnectedPayload {
  readonly peerId: string;
  /** `timeout` | `remote_bye` | `link_closed` | `local_disconnect` | `steam_session_failed` | outro. */
  readonly reason: string;
}

export const PeerDisconnectedEvent = defineEvent<
  "game.net.peer-disconnected",
  PeerDisconnectedPayload
>("game.net.peer-disconnected");

export interface WorldSnapshotPayload {
  readonly snapshot: WorldStateSnapshot;
}

export const WorldSnapshotEvent = defineEvent<
  "game.net.snapshot",
  WorldSnapshotPayload
>("game.net.snapshot");

// ── COMANDOS DE REDE ───────────────────────────────────────────────────────

export interface ConnectPeerRequest {
  readonly targetId: string;
  readonly transport?: TransportType;
}

export const ConnectPeerCommand = defineCommand<
  "game.net.connect",
  ConnectPeerRequest
>("game.net.connect");

export interface DisconnectPeerRequest {
  readonly reason?: string;
}

export const DisconnectPeerCommand = defineCommand<
  "game.net.disconnect",
  DisconnectPeerRequest
>("game.net.disconnect");

export interface SendNetPacketRequest {
  readonly targetId: string;
  readonly channel: number;
  readonly data: Uint8Array;
  readonly reliable: boolean;
}

export const SendNetPacketCommand = defineCommand<
  "game.net.send",
  SendNetPacketRequest
>("game.net.send");

export interface BroadcastSnapshotRequest {
  readonly snapshot: WorldStateSnapshot;
}

export const BroadcastSnapshotCommand = defineCommand<
  "game.net.broadcast-snapshot",
  BroadcastSnapshotRequest
>("game.net.broadcast-snapshot");