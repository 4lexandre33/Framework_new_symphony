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
## notas verificadas (comportamento)
- Sem Steam o transporte é WebSocket CLIENTE: `startHost()` resolve `false`; `connect("ws://…")` só conecta a um servidor/relay externo. Não há transporte mock/loopback nem host no navegador. Host P2P real só com Steam (Tauri).
- `sendTo`/`broadcast` resolvem `false` em modo `offline`. Nada lança.
- No tick a engine só faz `pollPackets()`. Snapshots NÃO são enviados sozinhos: o jogo gera (`getStateReplicator().generateWorldSnapshot`), serializa em `Uint8Array` e chama `broadcast`. Recebimento: evento `game.net.packet-received`.
- `registerEntity`/`updateEntityState`/`getInterpolatedState` funcionam em memória, sem conexão.
- Para testar multiplayer no jogo: isole a rede atrás de uma porta do jogo e use um transporte loopback de TESTE (dois "peers" em memória).
- `StateReplicator`: `pushEntitySnapshot` ignora snapshot com `sequence` não mais novo que o último; cria a entidade se não existir (`registerEntity` é opcional). `getInterpolatedState(id, alpha)` interpola entre os DOIS ÚLTIMOS snapshots com `alpha` 0..1 (com 1 snapshot devolve ele). Logo `alpha` deve ser "tempo desde a chegada do último snapshot ÷ intervalo entre snapshots", não o alpha do render. O objeto devolvido é reutilizado: copie os números.
- Steam: só canais 0 e 1 funcionam; pacote não confiável ≤ 1.200 B (G104). Queda de par não é detectada: faça heartbeat (G105). `rttMs` sempre 0 (G108).
