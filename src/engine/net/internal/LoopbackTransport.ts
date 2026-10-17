import type {
  TransportType,
} from "../../../contracts/net/types";

import type {
  TransportListenOptions,
} from "./NetworkTransport";

import {
  QueuedTransport,
} from "./QueuedTransport";

/**
 * Transporte em memória ("mock"): host e clientes no MESMO runtime JS
 * (multiplayer local, split-screen, testes). Endereço: `loopback://<sala>`
 * onde a sala é `room` ou `port` do `startHost` (padrão 7777).
 *
 * Entrega é assíncrona: o pacote vai para a fila do destino e só é
 * processado no `pollPackets()` dele (como uma rede real).
 */
export const DEFAULT_LOOPBACK_ROOM = "7777";
export const DEFAULT_LOOPBACK_MAX_FRAME_BYTES = 64 * 1024;

export type LoopbackPacketFilter = (
  fromId: string,
  toId: string,
  data: Uint8Array,
) => boolean;

const rooms = new Map<string, LoopbackTransport>();
let nextClientId = 1;

function normalizeRoom(value: string): string | null {
  const room = value.trim();
  return /^[A-Za-z0-9_.-]{1,64}$/u.test(room) ? room : null;
}

export function parseLoopbackTarget(target: string): string | null {
  const match = /^loopback:\/\/(.+)$/u.exec(target.trim());
  return match?.[1] ? normalizeRoom(match[1]) : null;
}

export interface LoopbackTransportOptions {
  readonly maxFrameBytes?: number;
  readonly now?: () => number;
}

export class LoopbackTransport extends QueuedTransport {
  public readonly type: TransportType = "mock";

  private role: "host" | "client" | null = null;
  private room: string | null = null;
  private endpointId = "";
  private hostId: string | null = null;
  private readonly clients = new Map<string, LoopbackTransport>();
  private readonly frameLimit: number;
  /** Filtro de teste: retorne `false` para "perder" o pacote. */
  public packetFilter: LoopbackPacketFilter | null = null;

  public constructor(options: LoopbackTransportOptions = {}) {
    super(options.now);
    this.frameLimit =
      Number.isInteger(options.maxFrameBytes) && (options.maxFrameBytes ?? 0) >= 64
        ? (options.maxFrameBytes as number)
        : DEFAULT_LOOPBACK_MAX_FRAME_BYTES;
  }

  public get isConnected(): boolean {
    return !this.disposed && this.role !== null;
  }

  public get localId(): string {
    return this.endpointId;
  }

  public override maxFrameBytes(): number {
    return this.frameLimit;
  }

  public async initialize(): Promise<boolean> {
    return !this.disposed;
  }

  public override async listen(options: TransportListenOptions = {}): Promise<boolean> {
    if (this.disposed || this.role !== null) return false;
    const room = normalizeRoom(options.room ?? String(options.port ?? DEFAULT_LOOPBACK_ROOM));
    if (room === null || rooms.has(room)) return false;

    rooms.set(room, this);
    this.role = "host";
    this.room = room;
    this.endpointId = `loopback-host:${room}`;
    return true;
  }

  public async connect(target: string): Promise<boolean> {
    if (this.disposed || this.role !== null) return false;
    const room = parseLoopbackTarget(target);
    const host = room === null ? undefined : rooms.get(room);
    if (!host || host.disposed || host.role !== "host") return false;

    this.endpointId = `loopback-client:${nextClientId}`;
    nextClientId += 1;
    this.role = "client";
    this.room = room;
    this.hostId = host.endpointId;
    this.linkPeers.add(host.endpointId);
    host.clients.set(this.endpointId, this);
    host.linkPeers.add(this.endpointId);
    return true;
  }

  public async disconnect(): Promise<void> {
    if (this.role === "host") {
      if (this.room !== null && rooms.get(this.room) === this) rooms.delete(this.room);
      for (const client of Array.from(this.clients.values())) {
        client.remoteClosed(this.endpointId);
      }
      this.clients.clear();
    } else if (this.role === "client" && this.room !== null) {
      const host = rooms.get(this.room);
      if (host && this.hostId === host.endpointId) {
        host.clients.delete(this.endpointId);
        host.remoteClosed(this.endpointId);
      }
    }

    this.linkPeers.clear();
    this.inbound.length = 0;
    this.role = null;
    this.room = null;
    this.hostId = null;
  }

  /** Lado remoto fechou o link (desconexão limpa, não silenciosa). */
  private remoteClosed(peerId: string): void {
    if (!this.linkPeers.delete(peerId)) return;
    this.clients.delete(peerId);
    if (this.role === "client" && this.hostId === peerId) {
      this.role = null;
      this.room = null;
      this.hostId = null;
    }
    this.notifyPeerDisconnected(peerId, "link_closed");
  }

  public override closePeer(peerId: string): void {
    const client = this.clients.get(peerId);
    if (!client) return;
    this.clients.delete(peerId);
    this.linkPeers.delete(peerId);
    client.remoteClosed(this.endpointId);
  }

  private resolveTarget(targetId: string): LoopbackTransport | null {
    if (this.role === "host") return this.clients.get(targetId) ?? null;
    if (this.role === "client" && this.room !== null && targetId === this.hostId) {
      const host = rooms.get(this.room);
      return host && host.endpointId === targetId ? host : null;
    }
    return null;
  }

  public async send(
    targetId: string,
    data: Uint8Array,
    channel: number,
    _reliable: boolean,
  ): Promise<boolean> {
    if (!this.isConnected || !this.canSendPacket(targetId, channel, data) || data.byteLength > this.frameLimit) {
      return false;
    }

    const target = this.resolveTarget(targetId);
    if (!target || target.disposed) return false;

    this.recordSent(data.byteLength);
    if (this.packetFilter && !this.packetFilter(this.endpointId, targetId, data)) {
      return true; // "perdido na rede": o envio local teve sucesso
    }

    target.enqueue(this.endpointId, channel, data.slice());
    return true;
  }

  public override dispose(): void {
    if (this.disposed) return;
    void this.disconnect();
    this.disposed = true;
    super.dispose();
  }
}
