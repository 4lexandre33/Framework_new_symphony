import { defineEvent, defineCommand } from "@core";

export type TransportType = "steam_p2p" | "websocket" | "webrtc" | "mock";

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
  processWorldSnapshot(worldSnapshot: WorldStateSnapshot): void;
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
  readonly rttMs: number;
  readonly packetLossRate: number;
  readonly bytesSentPerSec: number;
  readonly bytesReceivedPerSec: number;
  readonly activeConnections: number;
  readonly transportType: TransportType;
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