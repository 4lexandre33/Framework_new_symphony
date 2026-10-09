# net — Multiplayer Network & State Replication
capability: game.net@1.0.0 | category: runtime | engine plugin id: game.net
dependsOn: game.loop
consumes: SteamToken
use (from src/projects/<jogo>/**):
  import { NetworkToken } from "../../tokens/net";
  // acesso: const api = ctx.caps.require(Token)  (declare o token em capabilities.consumes + permissions.capabilities)

## token src/tokens/net.ts
```ts
interface NetworkApi {
  readonly mode: NetMode;
  readonly transportType: TransportType;
  startHost( options?: { port?: number; maxClients?: number; }, ): Promise<boolean>;
  connect( targetAddressOrSteamId: string, ): Promise<boolean>;
  disconnect(): Promise<void>;
  sendTo( targetId: string, channel: number, data: Uint8Array, reliable?: boolean, ): Promise<boolean>;
  broadcast( channel: number, data: Uint8Array, reliable?: boolean, ): Promise<boolean>;
  getStats(): NetworkStats;
  getStateReplicator(): StateReplicationApi;
  registerEntity( entityId: string, initialSnapshot: EntitySnapshot, ): void;
  unregisterEntity( entityId: string, ): void;
  updateEntityState( entityId: string, state: Partial<EntitySnapshot>, ): void;
  getInterpolatedState( entityId: string, renderAlpha: number, ): EntitySnapshot | null;
}
capability NetworkToken = "game.net"@1.0.0 api NetworkApi
```
## contract src/contracts/net/types.ts
```ts
export type TransportType = "steam_p2p" | "websocket" | "webrtc" | "mock";
export type NetMode = "host" | "client" | "offline";
interface NetVector3 {
  x: number;
  y: number;
  z: number;
}
interface NetQuaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}
interface EntitySnapshot {
  readonly entityId: string;
  readonly type: string;
  readonly position: NetVector3;
  readonly rotation: NetQuaternion;
  readonly velocity: NetVector3;
  readonly sequence: number;
  readonly timestamp: number;
}
interface WorldStateSnapshot {
  readonly sequence: number;
  readonly timestamp: number;
  readonly tick: number;
  readonly hostSteamId: string;
  readonly entities: ReadonlyArray<EntitySnapshot>;
}
interface StateReplicationApi {
  registerEntity(entityId: string, initialSnapshot: EntitySnapshot): void;
  unregisterEntity(entityId: string): void;
  pushEntitySnapshot(snapshot: EntitySnapshot): void;
  processWorldSnapshot(worldSnapshot: WorldStateSnapshot): void;
  getInterpolatedState(entityId: string, alpha: number): EntitySnapshot | null;
  generateWorldSnapshot(sequence: number, tick: number, hostSteamId: string): WorldStateSnapshot;
  clear(): void;
}
interface NetPacketHeader {
  readonly magic: number;
  readonly packetType: number;
  readonly sequence: number;
  readonly channel: number;
  readonly senderId: string;
  readonly timestamp: number;
}
interface NetPacket {
  readonly header: NetPacketHeader;
  readonly payload: Uint8Array;
}
interface NetworkStats {
  readonly rttMs: number;
  readonly packetLossRate: number;
  readonly bytesSentPerSec: number;
  readonly bytesReceivedPerSec: number;
  readonly activeConnections: number;
  readonly transportType: TransportType;
}
interface NetPacketReceivedPayload {
  readonly senderId: string;
  readonly channel: number;
  readonly data: Uint8Array;
}
event NetPacketReceivedEvent = "game.net.packet-received" payload NetPacketReceivedPayload
interface PeerConnectedPayload {
  readonly peerId: string;
  readonly transport: TransportType;
}
event PeerConnectedEvent = "game.net.peer-connected" payload PeerConnectedPayload
interface PeerDisconnectedPayload {
  readonly peerId: string;
  readonly reason: string;
}
event PeerDisconnectedEvent = "game.net.peer-disconnected" payload PeerDisconnectedPayload
interface WorldSnapshotPayload {
  readonly snapshot: WorldStateSnapshot;
}
event WorldSnapshotEvent = "game.net.snapshot" payload WorldSnapshotPayload
interface ConnectPeerRequest {
  readonly targetId: string;
  readonly transport?: TransportType;
}
command ConnectPeerCommand = "game.net.connect" request ConnectPeerRequest
interface DisconnectPeerRequest {
  readonly reason?: string;
}
command DisconnectPeerCommand = "game.net.disconnect" request DisconnectPeerRequest
interface SendNetPacketRequest {
  readonly targetId: string;
  readonly channel: number;
  readonly data: Uint8Array;
  readonly reliable: boolean;
}
command SendNetPacketCommand = "game.net.send" request SendNetPacketRequest
interface BroadcastSnapshotRequest {
  readonly snapshot: WorldStateSnapshot;
}
command BroadcastSnapshotCommand = "game.net.broadcast-snapshot" request BroadcastSnapshotRequest
```
