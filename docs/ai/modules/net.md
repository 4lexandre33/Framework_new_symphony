# net — Multiplayer Network & State Replication
capability: game.net@1.0.0 | category: runtime | engine plugin id: game.net
dependsOn: game.loop
consumes: SteamToken, SteamNetworkToken
use (from src/projects/<jogo>/**):
  import { NetworkToken } from "../../tokens/net";
  // acesso: const api = ctx.caps.require(Token)  (declare o token em capabilities.consumes + permissions.capabilities)

## token src/tokens/net.ts
```ts
interface NetworkApi {
  readonly mode: NetMode;
  readonly transportType: TransportType;
  startHost( options?: NetHostOptions, ): Promise<boolean>; // Abre uma sessão de host.
  connect( targetAddressOrSteamId: string, ): Promise<boolean>; // Conecta a um host e resolve `true` só após o handshake (WELCOME).
  disconnect(): Promise<void>;
  sendTo( targetId: string, channel: number, data: Uint8Array, reliable?: boolean, ): Promise<boolean>; // Envia a um par conectado.
  broadcast( channel: number, data: Uint8Array, reliable?: boolean, ): Promise<boolean>;
  getStats(): NetworkStats; // Não destrutivo: RTT e perda reais medidos por ping/pong da sessão.
  getStateReplicator(): StateReplicationApi;
  registerEntity( entityId: string, initialSnapshot: EntitySnapshot, ): void;
  unregisterEntity( entityId: string, ): void;
  updateEntityState( entityId: string, state: Partial<EntitySnapshot>, ): void;
  getInterpolatedState( entityId: string, renderAlpha: number, ): EntitySnapshot | null; // Estado interpolado.
  getHostEndpoint(): NetHostEndpoint | null; // G8: endereço do host WebSocket nativo ativo (para mostrar aos jogadores); null se não está hospedando por Web…
  getAvailableTransports(): ReadonlyArray<TransportType>; // Transportes utilizáveis neste runtime.
  setPreferredTransport( type: TransportType | null, ): boolean; // Transporte padrão do `startHost()` (só offline; `false` se indisponível).
  configure( options: NetSessionOptions, ): void; // Heartbeat/timeouts da sessão.
  getPeers(): ReadonlyArray<NetPeerInfo>; // Pares com handshake completo e suas métricas.
  broadcastSnapshot( snapshot?: WorldStateSnapshot, reliable?: boolean, ): Promise<boolean>; // Envia um snapshot de mundo aos pares (padrão: gerado do replicador).
  setAutoSnapshot( options: AutoSnapshotOptions, ): boolean; // Envio automático de snapshot pelo host a cada N ticks.
}
capability NetworkToken = "game.net"@1.0.0 api NetworkApi
```
## contract src/contracts/net/types.ts
```ts
export type TransportType = "steam_p2p" | "websocket" | "webrtc" | "mock" | "broadcast_channel"; // - `steam_p2p`: Steam (Tauri + Steam ativa); - `websocket`: cliente (`ws://ip:porta`) de um host/relay que fal…
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
function copyEntitySnapshot(src: EntitySnapshot): EntitySnapshot; // G31: `getInterpolatedState()` devolve um objeto REUTILIZADO por entidade (ou o snapshot interno do histórico).
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
  processWorldSnapshot(worldSnapshot: WorldStateSnapshot, sourcePeerId?: string): void; // Aplica um snapshot de mundo vindo de `sourcePeerId` (padrão: `worldSnapshot.hostSteamId`): cria/atualiza as e…
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
  readonly rttMs: number; // RTT médio medido por ping/pong da sessão (0 sem pares/medição).
  readonly packetLossRate: number; // Fração 0..1 de pings sem resposta na janela recente (perda real).
  readonly bytesSentPerSec: number;
  readonly bytesReceivedPerSec: number;
  readonly activeConnections: number;
  readonly transportType: TransportType;
}
interface NetHostOptions {
  readonly port?: number; // Sala do loopback/BroadcastChannel (padrão: `room` ou 7777).
  readonly maxClients?: number; // Limite de clientes aceitos no handshake (1..250, padrão 16).
  readonly transport?: TransportType; // Transporte explícito; padrão: Steam se disponível, senão `mock` (loopback).
  readonly room?: string; // Nome da sala (loopback/BroadcastChannel): `[A-Za-z0-9_.-]{1,64}`.
  readonly bind?: "loopback" | "lan"; // Host WebSocket nativo (G8): `loopback` (padrão; só esta máquina) ou `lan` (0.0.0.0; outros PCs da rede local …
}
interface NetHostEndpoint { // Endereço do host WebSocket nativo ativo (G8).
  readonly transport: "websocket";
  readonly port: number;
  readonly bind: "loopback" | "lan";
  readonly localUrl: string; // `ws://127.0.0.1:<porta>` (mesma máquina).
  readonly lanUrl: string | null; // `ws://<ip-lan>:<porta>` com `bind: "lan"` (IP provável; null se não descoberto).
}
interface NetSessionOptions {
  readonly heartbeatIntervalMs?: number; // Intervalo de ping (padrão 1000 ms).
  readonly peerTimeoutMs?: number; // Par sem tráfego por este tempo é desconectado (padrão 5000 ms).
  readonly handshakeTimeoutMs?: number; // Tempo máximo para o WELCOME do host no `connect` (padrão 5000 ms).
}
interface AutoSnapshotOptions {
  readonly enabled: boolean;
  readonly intervalTicks?: number; // Envia a cada N ticks do game loop (padrão 3).
  readonly reliable?: boolean; // Snapshot confiável (padrão false; acima do MTU usa confiável fragmentado).
}
interface NetPeerInfo {
  readonly peerId: string;
  readonly rttMs: number | null; // RTT suavizado; `null` antes do primeiro pong.
  readonly packetLossRate: number;
  readonly lastHeardMs: number;
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
  readonly reason: string; // `timeout` | `remote_bye` | `link_closed` | `local_disconnect` | `steam_session_failed` | outro.
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
- Transportes (`getAvailableTransports()`): `steam_p2p` (Tauri + Steam), `mock` = loopback no mesmo runtime (`loopback://sala`), `broadcast_channel` = abas da mesma origem (`bc://sala`), `websocket` = CLIENTE (`ws://ip:porta`) e, só no app nativo, HOST (servidor WebSocket no Rust): `startHost({ transport: "websocket", port: 7777, bind: "loopback" | "lan", maxClients })`; `getHostEndpoint()` dá `localUrl`/`lanUrl` para mostrar aos jogadores (sem TLS; `lan` expõe à rede local; no navegador `startHost` websocket resolve `false`). `webrtc` não existe (GAPS G8).
- Host: `startHost({ transport?, room?, maxClients? })` (padrão: Steam se disponível, senão `mock`). Cliente: `connect(alvo)` resolve `true` só após o handshake (WELCOME); `false` sem host/sem resposta (`handshakeTimeoutMs` 5 s).
- Sessão: heartbeat (1 s) e timeout de par (5 s) automáticos (`configure`); `game.net.peer-connected`/`peer-disconnected` (`reason`: timeout, remote_bye, link_closed…). `getPeers()` e `getStats()` (RTT/perda reais, não destrutivo).
- Envio: `sendTo`/`broadcast` com canal 0..255 preservado; confiável grande é fragmentado (até 16 MiB); NÃO confiável acima do MTU resolve `false`. Offline resolve `false`. Recebimento: `game.net.packet-received`.
- O pump da rede roda no tick/render da engine e, com a aba/janela OCULTA (loop suspenso), num relógio em Worker do plugin (G130): heartbeat, handshake e recebimento continuam e o host não derruba clientes. A SIMULAÇÃO (tick) continua parada e o snapshot automático (por tick) não sai. Desligar: `createNetworkPlugin({ backgroundPump: false })`; intervalo: `backgroundPump: { intervalMs }` (padrão 200).
- Replicação: `registerEntity`/`updateEntityState` (entidades LOCAIS, nunca sobrescritas por remotos); `broadcastSnapshot()` ou `setAutoSnapshot({ enabled, intervalTicks: 3 })` no host; no cliente o snapshot é aplicado ao replicador (cria/atualiza/remove as entidades daquela origem) e sai `game.net.snapshot`.
- `getInterpolatedState(id, alpha)` interpola entre os DOIS ÚLTIMOS snapshots (quatérnio com sinal corrigido); `alpha` = tempo desde a chegada do último ÷ intervalo entre snapshots (não o alpha do render). Objeto reutilizado: `copyEntitySnapshot`.
- Com Steam, `game.net` aceita as sessões P2P (host aceita clientes; cliente só o seu host) e drena os pacotes: não leia P2P direto pelo `game.steam.net` ao mesmo tempo.
