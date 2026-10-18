import type {
  NetPeerInfo,
  NetSessionOptions,
  WorldStateSnapshot,
} from "../../../contracts/net/types";

import {
  FRAME_BYE,
  FRAME_DATA,
  FRAME_FRAGMENT,
  FRAME_HELLO,
  FRAME_PING,
  FRAME_PONG,
  FRAME_REJECT,
  FRAME_SNAPSHOT,
  FRAME_WELCOME,
  MAX_FRAGMENTS_PER_MESSAGE,
  MAX_NET_MESSAGE_BYTES,
  NET_FRAGMENT_HEADER_BYTES,
  NET_HEADER_BYTES,
  decodeFrame,
  decodeSnapshotPayload,
  encodeByeFrame,
  encodeDataFrame,
  encodeFragmentFrame,
  encodeHelloFrame,
  encodePingFrame,
  encodePongFrame,
  encodeRejectFrame,
  encodeSnapshotFrame,
  encodeSnapshotPayload,
  encodeWelcomeFrame,
} from "./NetProtocol";

import {
  isValidNetworkChannel,
} from "./NetworkPacketValidator";

import type {
  NetworkTransport,
} from "./NetworkTransport";

import {
  RateMeter,
} from "./RateMeter";

export const DEFAULT_HEARTBEAT_INTERVAL_MS = 1000;
export const DEFAULT_PEER_TIMEOUT_MS = 5000;
export const DEFAULT_HANDSHAKE_TIMEOUT_MS = 5000;
export const DEFAULT_MAX_CLIENTS = 16;
export const MAX_CLIENTS_LIMIT = 250;
export const HELLO_RESEND_INTERVAL_MS = 500;
export const MAX_REASSEMBLIES_PER_PEER = 8;
export const MAX_REASSEMBLY_BYTES_PER_PEER = 32 * 1024 * 1024;
export const REASSEMBLY_TIMEOUT_MS = 15_000;
/**
 * Links do transporte ainda sem HELLO acompanhados pelo host. Acima disto,
 * links novos são fechados na hora (o transporte nativo já limita conexões).
 */
export const MAX_PENDING_LINKS = 1024;
const PING_HISTORY = 32;
const RTT_SMOOTHING = 0.125;
/** Canal do transporte usado para frames de controle. */
const CONTROL_CHANNEL = 0;

interface Reassembly {
  readonly count: number;
  readonly innerType: typeof FRAME_DATA | typeof FRAME_SNAPSHOT;
  readonly channel: number;
  readonly chunks: Array<Uint8Array | undefined>;
  received: number;
  bytes: number;
  readonly startedMs: number;
}

interface SessionPeer {
  readonly id: string;
  lastHeardMs: number;
  lastPingMs: number;
  pingSeq: number;
  rttMs: number | null;
  readonly pendingPings: Map<number, number>;
  /** 1 = respondido, 0 = perdido (anel). */
  readonly pingOutcomes: Uint8Array;
  pingOutcomeCount: number;
  pingOutcomeIndex: number;
  readonly reassembly: Map<number, Reassembly>;
  reassemblyBytes: number;
}

export interface NetSessionHooks {
  onPeerConnected(peerId: string): void;
  onPeerDisconnected(peerId: string, reason: string): void;
  onData(peerId: string, channel: number, data: Uint8Array): void;
  onSnapshot(peerId: string, snapshot: WorldStateSnapshot): void;
  /** O cliente perdeu o host (timeout/bye/link) — sessão voltou a ociosa. */
  onSessionClosed(reason: string): void;
}

export interface NetSessionCounters {
  readonly invalidFrames: number;
  readonly rejectedSends: number;
  readonly fragmentsSent: number;
  readonly messagesReassembled: number;
}

function createPeer(id: string, now: number): SessionPeer {
  return {
    id,
    lastHeardMs: now,
    lastPingMs: now,
    pingSeq: 0,
    rttMs: null,
    pendingPings: new Map(),
    pingOutcomes: new Uint8Array(PING_HISTORY),
    pingOutcomeCount: 0,
    pingOutcomeIndex: 0,
    reassembly: new Map(),
    reassemblyBytes: 0,
  };
}

function recordPingOutcome(peer: SessionPeer, answered: boolean): void {
  peer.pingOutcomes[peer.pingOutcomeIndex] = answered ? 1 : 0;
  peer.pingOutcomeIndex = (peer.pingOutcomeIndex + 1) % PING_HISTORY;
  peer.pingOutcomeCount = Math.min(PING_HISTORY, peer.pingOutcomeCount + 1);
}

function peerLossRate(peer: SessionPeer): number {
  if (peer.pingOutcomeCount === 0) return 0;
  let lost = 0;
  for (let index = 0; index < peer.pingOutcomeCount; index += 1) {
    if (peer.pingOutcomes[index] === 0) lost += 1;
  }
  return lost / peer.pingOutcomeCount;
}

function positiveInt(value: number | undefined, fallback: number, min: number, max: number): number {
  return Number.isFinite(value) && (value as number) >= min && (value as number) <= max
    ? Math.trunc(value as number)
    : fallback;
}

/**
 * Sessão sobre um `NetworkTransport`: handshake HELLO/WELCOME, limite de
 * clientes, heartbeat (ping/pong → RTT e perda reais), timeouts, BYE,
 * fragmentação/remontagem de mensagens confiáveis grandes e snapshots.
 */
export class NetSession {
  private role: "host" | "client" | null = null;
  private readonly peers = new Map<string, SessionPeer>();
  /**
   * Host: links abertos no transporte que ainda não mandaram HELLO
   * (linkId → instante da conexão, no relógio da sessão). Quem não completar
   * o handshake em `handshakeTimeoutMs` é fechado (`closePeer`) no `update()`
   * — sem timers: o prazo usa o mesmo `now()` do heartbeat.
   */
  private readonly pendingLinks = new Map<string, number>();
  private maxClients = DEFAULT_MAX_CLIENTS;
  private heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS;
  private peerTimeoutMs = DEFAULT_PEER_TIMEOUT_MS;
  private handshakeTimeoutMs = DEFAULT_HANDSHAKE_TIMEOUT_MS;
  private nextMessageId = 1;
  private pendingHandshake: {
    readonly linkId: string;
    readonly deadline: number;
    lastHelloMs: number;
    readonly resolve: (ok: boolean) => void;
  } | null = null;
  private readonly sentMeter: RateMeter;
  private readonly receivedMeter: RateMeter;
  private counters = {
    invalidFrames: 0,
    rejectedSends: 0,
    fragmentsSent: 0,
    messagesReassembled: 0,
  };

  public constructor(
    private readonly transport: NetworkTransport,
    private readonly hooks: NetSessionHooks,
    private readonly now: () => number,
    private readonly localPeerId: () => string,
  ) {
    this.sentMeter = new RateMeter(now);
    this.receivedMeter = new RateMeter(now);
  }

  public get activeRole(): "host" | "client" | null {
    return this.role;
  }

  public get hostPeerId(): string | null {
    return this.role === "client" ? (this.peers.keys().next().value ?? null) : null;
  }

  public configure(options: NetSessionOptions): void {
    this.heartbeatIntervalMs = positiveInt(options.heartbeatIntervalMs, this.heartbeatIntervalMs, 10, 60_000);
    this.peerTimeoutMs = positiveInt(options.peerTimeoutMs, this.peerTimeoutMs, 50, 600_000);
    this.handshakeTimeoutMs = positiveInt(options.handshakeTimeoutMs, this.handshakeTimeoutMs, 10, 600_000);
  }

  public get heartbeatMs(): number {
    return this.heartbeatIntervalMs;
  }

  public startHost(maxClients: number): void {
    this.role = "host";
    this.maxClients = maxClients;
    this.pendingLinks.clear();
  }

  /**
   * Link novo no transporte (ex.: socket aceito pelo host nativo). No host,
   * começa o prazo de handshake; HELLO dentro do prazo vira par (ou REJECT).
   */
  public handleLinkConnected(linkId: string): void {
    if (this.role !== "host" || this.peers.has(linkId) || this.pendingLinks.has(linkId)) return;
    if (this.pendingLinks.size >= MAX_PENDING_LINKS) {
      this.transport.closePeer(linkId);
      return;
    }
    this.pendingLinks.set(linkId, this.now());
  }

  /** Links abertos aguardando HELLO (diagnóstico/testes). */
  public get pendingLinkCount(): number {
    return this.pendingLinks.size;
  }

  /** Handshake de cliente: HELLO até WELCOME, REJECT ou timeout. */
  public connect(hostLinkId: string): Promise<boolean> {
    this.role = "client";
    const now = this.now();

    return new Promise<boolean>((resolve) => {
      this.pendingHandshake = {
        linkId: hostLinkId,
        deadline: now + this.handshakeTimeoutMs,
        lastHelloMs: now,
        resolve,
      };
      void this.sendRaw(hostLinkId, encodeHelloFrame(), CONTROL_CHANNEL, true);
    });
  }

  public isPeer(peerId: string): boolean {
    return this.peers.has(peerId);
  }

  public getPeerIds(): ReadonlyArray<string> {
    return Array.from(this.peers.keys());
  }

  public getPeers(): ReadonlyArray<NetPeerInfo> {
    const result: NetPeerInfo[] = [];
    for (const peer of this.peers.values()) {
      result.push({
        peerId: peer.id,
        rttMs: peer.rttMs,
        packetLossRate: peerLossRate(peer),
        lastHeardMs: peer.lastHeardMs,
      });
    }
    return result;
  }

  public get counterSnapshot(): NetSessionCounters {
    return { ...this.counters };
  }

  public averageRttMs(): number {
    let sum = 0;
    let count = 0;
    for (const peer of this.peers.values()) {
      if (peer.rttMs !== null) {
        sum += peer.rttMs;
        count += 1;
      }
    }
    return count > 0 ? sum / count : 0;
  }

  public averageLossRate(): number {
    let sum = 0;
    let count = 0;
    for (const peer of this.peers.values()) {
      if (peer.pingOutcomeCount > 0) {
        sum += peerLossRate(peer);
        count += 1;
      }
    }
    return count > 0 ? sum / count : 0;
  }

  public bytesSentPerSec(): number {
    return this.sentMeter.perSecond();
  }

  public bytesReceivedPerSec(): number {
    return this.receivedMeter.perSecond();
  }

  private async sendRaw(linkId: string, frame: Uint8Array, channel: number, reliable: boolean): Promise<boolean> {
    let sent = false;
    try {
      sent = await this.transport.send(linkId, frame, channel, reliable);
    } catch {
      sent = false;
    }
    if (sent) this.sentMeter.add(frame.byteLength);
    return sent;
  }

  /**
   * Envia uma mensagem do jogo. Mensagem confiável maior que o frame do
   * transporte é fragmentada; não confiável acima do frame é RECUSADA.
   */
  public async send(peerId: string, channel: number, data: Uint8Array, reliable: boolean): Promise<boolean> {
    if (
      !this.peers.has(peerId) ||
      !isValidNetworkChannel(channel) ||
      !(data instanceof Uint8Array) ||
      data.byteLength > MAX_NET_MESSAGE_BYTES
    ) {
      this.counters.rejectedSends += 1;
      return false;
    }

    const ok = await this.sendMessage(peerId, channel, FRAME_DATA, data, reliable);
    if (!ok) this.counters.rejectedSends += 1;
    return ok;
  }

  public async broadcast(channel: number, data: Uint8Array, reliable: boolean): Promise<boolean> {
    if (this.peers.size === 0) return false;
    let all = true;
    for (const peerId of Array.from(this.peers.keys())) {
      if (!(await this.send(peerId, channel, data, reliable))) all = false;
    }
    return all;
  }

  public async broadcastSnapshot(snapshot: WorldStateSnapshot, reliable: boolean): Promise<boolean> {
    if (this.peers.size === 0) return false;
    const payload = encodeSnapshotPayload(snapshot);
    if (payload.byteLength > MAX_NET_MESSAGE_BYTES) return false;
    let all = true;
    for (const peerId of Array.from(this.peers.keys())) {
      if (!(await this.sendMessage(peerId, 0, FRAME_SNAPSHOT, payload, reliable))) all = false;
    }
    return all;
  }

  private async sendMessage(
    peerId: string,
    channel: number,
    innerType: typeof FRAME_DATA | typeof FRAME_SNAPSHOT,
    payload: Uint8Array,
    reliable: boolean,
  ): Promise<boolean> {
    const frameLimit = this.transport.maxFrameBytes(reliable);
    const single =
      innerType === FRAME_DATA ? NET_HEADER_BYTES + payload.byteLength : NET_HEADER_BYTES + payload.byteLength;

    if (single <= frameLimit) {
      const frame = innerType === FRAME_DATA ? encodeDataFrame(channel, payload) : encodeSnapshotFrame(payload);
      return this.sendRaw(peerId, frame, channel, reliable);
    }

    // Não confiável grande: snapshot sobe para confiável; dados do jogo são recusados.
    if (!reliable) {
      if (innerType === FRAME_SNAPSHOT) {
        return this.sendMessage(peerId, channel, innerType, payload, true);
      }
      return false;
    }

    const reliableLimit = this.transport.maxFrameBytes(true);
    const chunkSize = reliableLimit - NET_FRAGMENT_HEADER_BYTES;
    if (chunkSize <= 0) return false;
    const count = Math.ceil(payload.byteLength / chunkSize);
    if (count > MAX_FRAGMENTS_PER_MESSAGE) return false;

    const messageId = this.nextMessageId;
    this.nextMessageId = this.nextMessageId >= 0xffffffff ? 1 : this.nextMessageId + 1;

    for (let index = 0; index < count; index += 1) {
      const chunk = payload.subarray(index * chunkSize, Math.min(payload.byteLength, (index + 1) * chunkSize));
      const frame = encodeFragmentFrame(channel, messageId, index, count, innerType, chunk);
      if (!(await this.sendRaw(peerId, frame, channel, true))) return false;
      this.counters.fragmentsSent += 1;
    }

    return true;
  }

  /** Entrada de frames do transporte. */
  public handleRaw(linkId: string, data: Uint8Array): void {
    if (this.role === null) return;
    const frame = decodeFrame(data);
    if (frame === null) {
      this.counters.invalidFrames += 1;
      return;
    }

    this.receivedMeter.add(data.byteLength);
    const now = this.now();

    if (this.role === "host") {
      if (frame.type === FRAME_HELLO) {
        this.handleHello(linkId, now);
        return;
      }
    } else if (this.pendingHandshake && linkId === this.pendingHandshake.linkId) {
      if (frame.type === FRAME_WELCOME) {
        const pending = this.pendingHandshake;
        this.pendingHandshake = null;
        this.peers.set(linkId, createPeer(linkId, now));
        this.hooks.onPeerConnected(linkId);
        pending.resolve(true);
        return;
      }
      if (frame.type === FRAME_REJECT) {
        const pending = this.pendingHandshake;
        this.pendingHandshake = null;
        this.role = null;
        pending.resolve(false);
        return;
      }
    }

    const peer = this.peers.get(linkId);
    if (!peer) {
      // Tráfego de quem não completou o handshake é ignorado.
      this.counters.invalidFrames += 1;
      return;
    }

    peer.lastHeardMs = now;

    switch (frame.type) {
      case FRAME_DATA:
        this.hooks.onData(linkId, frame.channel, frame.payload);
        return;
      case FRAME_SNAPSHOT:
        this.deliverSnapshot(linkId, frame.payload);
        return;
      case FRAME_FRAGMENT:
        this.handleFragment(peer, frame, now);
        return;
      case FRAME_PING:
        void this.sendRaw(linkId, encodePongFrame(frame.seq, frame.sentAtMs), CONTROL_CHANNEL, false);
        return;
      case FRAME_PONG: {
        const sentAt = peer.pendingPings.get(frame.seq);
        if (sentAt === undefined) return;
        peer.pendingPings.delete(frame.seq);
        const sample = Math.max(0, now - sentAt);
        peer.rttMs = peer.rttMs === null ? sample : peer.rttMs + (sample - peer.rttMs) * RTT_SMOOTHING;
        recordPingOutcome(peer, true);
        return;
      }
      case FRAME_BYE:
        this.removePeer(linkId, "remote_bye", false);
        return;
      case FRAME_HELLO:
        // Cliente reenviou HELLO (WELCOME perdido): responde de novo.
        if (this.role === "host") void this.sendRaw(linkId, encodeWelcomeFrame(this.localPeerId()), CONTROL_CHANNEL, true);
        return;
      default:
        return;
    }
  }

  private handleHello(linkId: string, now: number): void {
    this.pendingLinks.delete(linkId);
    const existing = this.peers.get(linkId);
    if (existing) {
      existing.lastHeardMs = now;
      void this.sendRaw(linkId, encodeWelcomeFrame(this.localPeerId()), CONTROL_CHANNEL, true);
      return;
    }

    if (this.peers.size >= this.maxClients) {
      void this.sendRaw(linkId, encodeRejectFrame("server_full"), CONTROL_CHANNEL, true).then(() => {
        this.transport.closePeer(linkId);
      });
      return;
    }

    this.peers.set(linkId, createPeer(linkId, now));
    void this.sendRaw(linkId, encodeWelcomeFrame(this.localPeerId()), CONTROL_CHANNEL, true);
    this.hooks.onPeerConnected(linkId);
  }

  private deliverSnapshot(peerId: string, payload: Uint8Array): void {
    const snapshot = decodeSnapshotPayload(payload);
    if (snapshot === null) {
      this.counters.invalidFrames += 1;
      return;
    }
    this.hooks.onSnapshot(peerId, snapshot);
  }

  private handleFragment(
    peer: SessionPeer,
    frame: Extract<ReturnType<typeof decodeFrame>, { type: typeof FRAME_FRAGMENT }>,
    now: number,
  ): void {
    let entry = peer.reassembly.get(frame.messageId);

    if (!entry) {
      if (peer.reassembly.size >= MAX_REASSEMBLIES_PER_PEER) {
        this.counters.invalidFrames += 1;
        return;
      }
      entry = {
        count: frame.count,
        innerType: frame.innerType,
        channel: frame.channel,
        chunks: new Array<Uint8Array | undefined>(frame.count),
        received: 0,
        bytes: 0,
        startedMs: now,
      };
      peer.reassembly.set(frame.messageId, entry);
    }

    if (
      entry.count !== frame.count ||
      entry.innerType !== frame.innerType ||
      entry.channel !== frame.channel ||
      entry.chunks[frame.index] !== undefined
    ) {
      this.counters.invalidFrames += 1;
      return;
    }

    if (
      entry.bytes + frame.chunk.byteLength > MAX_NET_MESSAGE_BYTES ||
      peer.reassemblyBytes + frame.chunk.byteLength > MAX_REASSEMBLY_BYTES_PER_PEER
    ) {
      this.dropReassembly(peer, frame.messageId);
      this.counters.invalidFrames += 1;
      return;
    }

    entry.chunks[frame.index] = frame.chunk.slice();
    entry.received += 1;
    entry.bytes += frame.chunk.byteLength;
    peer.reassemblyBytes += frame.chunk.byteLength;

    if (entry.received < entry.count) return;

    const message = new Uint8Array(entry.bytes);
    let offset = 0;
    for (const chunk of entry.chunks) {
      if (!chunk) return;
      message.set(chunk, offset);
      offset += chunk.byteLength;
    }
    this.dropReassembly(peer, frame.messageId);
    this.counters.messagesReassembled += 1;

    if (entry.innerType === FRAME_DATA) {
      this.hooks.onData(peer.id, entry.channel, message);
    } else {
      this.deliverSnapshot(peer.id, message);
    }
  }

  private dropReassembly(peer: SessionPeer, messageId: number): void {
    const entry = peer.reassembly.get(messageId);
    if (!entry) return;
    peer.reassemblyBytes = Math.max(0, peer.reassemblyBytes - entry.bytes);
    peer.reassembly.delete(messageId);
  }

  /** Queda do link reportada pelo transporte. */
  public handleLinkDisconnected(linkId: string, reason: string): void {
    this.pendingLinks.delete(linkId);
    if (this.pendingHandshake && this.pendingHandshake.linkId === linkId) {
      const pending = this.pendingHandshake;
      this.pendingHandshake = null;
      this.role = null;
      pending.resolve(false);
      return;
    }
    this.removePeer(linkId, reason || "link_closed", false);
  }

  /** Heartbeat, timeouts, reenvio de HELLO e limpeza de remontagens. */
  public update(): void {
    const now = this.now();

    if (this.pendingHandshake) {
      const pending = this.pendingHandshake;
      if (now >= pending.deadline) {
        this.pendingHandshake = null;
        this.role = null;
        pending.resolve(false);
      } else if (now - pending.lastHelloMs >= HELLO_RESEND_INTERVAL_MS) {
        pending.lastHelloMs = now;
        void this.sendRaw(pending.linkId, encodeHelloFrame(), CONTROL_CHANNEL, true);
      }
    }

    if (this.role === "host" && this.pendingLinks.size > 0) {
      for (const [linkId, connectedAt] of this.pendingLinks) {
        if (now - connectedAt >= this.handshakeTimeoutMs) {
          // Link ocioso sem HELLO: libera a vaga no transporte.
          this.pendingLinks.delete(linkId);
          this.transport.closePeer(linkId);
        }
      }
    }

    for (const peer of Array.from(this.peers.values())) {
      if (now - peer.lastHeardMs >= this.peerTimeoutMs) {
        this.removePeer(peer.id, "timeout", false);
        continue;
      }

      // pings sem resposta há mais de 2 intervalos contam como perdidos
      for (const [seq, sentAt] of peer.pendingPings) {
        if (now - sentAt > this.heartbeatIntervalMs * 2) {
          peer.pendingPings.delete(seq);
          recordPingOutcome(peer, false);
        }
      }

      if (now - peer.lastPingMs >= this.heartbeatIntervalMs) {
        peer.lastPingMs = now;
        peer.pingSeq = (peer.pingSeq + 1) >>> 0;
        if (peer.pendingPings.size < PING_HISTORY) peer.pendingPings.set(peer.pingSeq, now);
        void this.sendRaw(peer.id, encodePingFrame(peer.pingSeq, now), CONTROL_CHANNEL, false);
      }

      for (const [messageId, entry] of peer.reassembly) {
        if (now - entry.startedMs > REASSEMBLY_TIMEOUT_MS) this.dropReassembly(peer, messageId);
      }
    }
  }

  /** Remove um par (expulsar, timeout ou queda). */
  public removePeer(peerId: string, reason: string, notifyRemote: boolean): boolean {
    const peer = this.peers.get(peerId);
    if (!peer) return false;
    if (notifyRemote) void this.sendRaw(peerId, encodeByeFrame(reason), CONTROL_CHANNEL, true);
    this.peers.delete(peerId);
    this.transport.closePeer(peerId);
    this.hooks.onPeerDisconnected(peerId, reason);

    if (this.role === "client") {
      this.role = null;
      this.hooks.onSessionClosed(reason);
    }
    return true;
  }

  /** Encerra a sessão: BYE para todos, sem eventos de "queda" duplicados. */
  public async close(reason: string): Promise<ReadonlyArray<string>> {
    if (this.pendingHandshake) {
      const pending = this.pendingHandshake;
      this.pendingHandshake = null;
      pending.resolve(false);
    }

    this.pendingLinks.clear();
    const removed = Array.from(this.peers.keys());
    for (const peerId of removed) {
      await this.sendRaw(peerId, encodeByeFrame(reason), CONTROL_CHANNEL, true);
    }
    this.peers.clear();
    this.role = null;
    return removed;
  }
}
