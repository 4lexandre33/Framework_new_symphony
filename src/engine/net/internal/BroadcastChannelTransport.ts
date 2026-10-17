import type {
  TransportType,
} from "../../../contracts/net/types";

import {
  MAX_NETWORK_PACKET_BYTES,
  isValidNetworkChannel,
  isValidNetworkPeerId,
} from "./NetworkPacketValidator";

import type {
  TransportListenOptions,
} from "./NetworkTransport";

import {
  QueuedTransport,
} from "./QueuedTransport";

/**
 * Transporte entre abas/janelas da MESMA origem via `BroadcastChannel`
 * (multiplayer local sem servidor). Endereço: `bc://<sala>` (ou
 * `broadcast://<sala>`); o host abre com `startHost({ transport:
 * "broadcast_channel", room })` (sala padrão = porta ou 7777).
 *
 * Não atravessa máquinas: para rede real use Steam P2P ou WebSocket.
 */
const CHANNEL_PREFIX = "symphony-net:";

interface WireMessage {
  readonly v: 1;
  readonly from: string;
  readonly to: string;
  readonly channel: number;
  readonly data: ArrayBuffer;
}

type BroadcastChannelLike = {
  postMessage(message: unknown): void;
  close(): void;
  onmessage: ((event: MessageEvent) => void) | null;
};

type BroadcastChannelFactory = (name: string) => BroadcastChannelLike;

function defaultFactory(): BroadcastChannelFactory | null {
  const ctor = (globalThis as { BroadcastChannel?: new (name: string) => BroadcastChannelLike }).BroadcastChannel;
  return typeof ctor === "function" ? (name) => new ctor(name) : null;
}

function normalizeRoom(value: string): string | null {
  const room = value.trim();
  return /^[A-Za-z0-9_.-]{1,64}$/u.test(room) ? room : null;
}

export function parseBroadcastTarget(target: string): string | null {
  const match = /^(?:bc|broadcast):\/\/(.+)$/u.exec(target.trim());
  return match?.[1] ? normalizeRoom(match[1]) : null;
}

function isWireMessage(value: unknown): value is WireMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Partial<WireMessage>;
  return (
    message.v === 1 &&
    typeof message.from === "string" &&
    typeof message.to === "string" &&
    typeof message.channel === "number" &&
    message.data instanceof ArrayBuffer
  );
}

let instanceCounter = 0;

export interface BroadcastChannelTransportOptions {
  readonly factory?: BroadcastChannelFactory;
  readonly now?: () => number;
}

export class BroadcastChannelTransport extends QueuedTransport {
  public readonly type: TransportType = "broadcast_channel";

  private readonly factory: BroadcastChannelFactory | null;
  private channel: BroadcastChannelLike | null = null;
  private role: "host" | "client" | null = null;
  private endpointId = "";
  private hostId: string | null = null;

  public constructor(options: BroadcastChannelTransportOptions = {}) {
    super(options.now);
    this.factory = options.factory ?? defaultFactory();
  }

  public static isSupported(): boolean {
    return defaultFactory() !== null;
  }

  public get isConnected(): boolean {
    return !this.disposed && this.channel !== null && this.role !== null;
  }

  public get localId(): string {
    return this.endpointId;
  }

  public override get canHost(): boolean {
    return this.factory !== null;
  }

  public override maxFrameBytes(): number {
    return MAX_NETWORK_PACKET_BYTES;
  }

  public async initialize(): Promise<boolean> {
    return !this.disposed && this.factory !== null;
  }

  private open(room: string): boolean {
    if (!this.factory) return false;
    try {
      const channel = this.factory(`${CHANNEL_PREFIX}${room}`);
      channel.onmessage = (event: MessageEvent): void => this.onMessage(event.data);
      this.channel = channel;
      return true;
    } catch {
      this.channel = null;
      return false;
    }
  }

  public override async listen(options: TransportListenOptions = {}): Promise<boolean> {
    if (this.disposed || this.role !== null) return false;
    const room = normalizeRoom(options.room ?? String(options.port ?? 7777));
    if (room === null || !this.open(room)) return false;
    this.role = "host";
    this.endpointId = `bc-host:${room}`;
    return true;
  }

  public async connect(target: string): Promise<boolean> {
    if (this.disposed || this.role !== null) return false;
    const room = parseBroadcastTarget(target);
    if (room === null || !this.open(room)) return false;
    instanceCounter += 1;
    const random = (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}`).slice(0, 8);
    this.endpointId = `bc-client:${instanceCounter}-${random}`;
    this.role = "client";
    this.hostId = `bc-host:${room}`;
    this.linkPeers.add(this.hostId);
    return true;
  }

  private onMessage(value: unknown): void {
    if (this.disposed || !isWireMessage(value) || value.to !== this.endpointId) return;
    if (!isValidNetworkPeerId(value.from) || !isValidNetworkChannel(value.channel)) return;
    if (value.data.byteLength > MAX_NETWORK_PACKET_BYTES) return;

    if (this.role === "client" && value.from !== this.hostId) return;
    if (this.role === "host" && !this.linkPeers.has(value.from)) {
      this.linkPeers.add(value.from);
      this.notifyPeerConnected(value.from);
    }

    this.enqueue(value.from, value.channel, new Uint8Array(value.data));
  }

  public async send(
    targetId: string,
    data: Uint8Array,
    channel: number,
    _reliable: boolean,
  ): Promise<boolean> {
    if (!this.isConnected || !this.channel || !this.canSendPacket(targetId, channel, data)) return false;
    if (!this.linkPeers.has(targetId)) return false;

    const copy = data.slice();
    const message: WireMessage = {
      v: 1,
      from: this.endpointId,
      to: targetId,
      channel,
      data: copy.buffer as ArrayBuffer,
    };

    try {
      this.channel.postMessage(message);
      this.recordSent(data.byteLength);
      return true;
    } catch {
      return false;
    }
  }

  public override closePeer(peerId: string): void {
    this.linkPeers.delete(peerId);
  }

  public async disconnect(): Promise<void> {
    if (this.channel) {
      this.channel.onmessage = null;
      try {
        this.channel.close();
      } catch {
        // best-effort
      }
    }
    this.channel = null;
    this.role = null;
    this.hostId = null;
    this.linkPeers.clear();
    this.inbound.length = 0;
  }

  public override dispose(): void {
    if (this.disposed) return;
    void this.disconnect();
    this.disposed = true;
    super.dispose();
  }
}
