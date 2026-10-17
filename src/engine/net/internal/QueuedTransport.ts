import type {
  NetworkStats,
} from "../../../contracts/net/types";

import {
  isValidNetworkChannel,
  isValidNetworkPayload,
  isValidNetworkPeerId,
} from "./NetworkPacketValidator";

import {
  NetworkTransport,
} from "./NetworkTransport";

import {
  RateMeter,
} from "./RateMeter";

export const MAX_QUEUED_INBOUND_PACKETS = 4096;
export const MAX_PACKETS_PER_POLL = 1024;

interface InboundPacket {
  readonly from: string;
  readonly channel: number;
  readonly data: Uint8Array;
}

/**
 * Base de transportes que recebem de forma assíncrona e entregam os pacotes
 * no `pollPackets()` (tick-driven, determinístico para testes).
 */
export abstract class QueuedTransport extends NetworkTransport {
  protected readonly inbound: InboundPacket[] = [];
  protected readonly linkPeers = new Set<string>();
  protected readonly sentMeter: RateMeter;
  protected readonly receivedMeter: RateMeter;
  protected droppedInbound = 0;
  protected disposed = false;

  protected constructor(
    protected readonly now: () => number = () => performance.now(),
  ) {
    super();
    this.sentMeter = new RateMeter(now);
    this.receivedMeter = new RateMeter(now);
  }

  protected enqueue(from: string, channel: number, data: Uint8Array): void {
    if (
      this.disposed ||
      !isValidNetworkPeerId(from) ||
      !isValidNetworkChannel(channel) ||
      !isValidNetworkPayload(data)
    ) {
      return;
    }

    if (this.inbound.length >= MAX_QUEUED_INBOUND_PACKETS) {
      this.inbound.shift();
      this.droppedInbound += 1;
    }

    this.inbound.push({ from, channel, data });
  }

  public async pollPackets(): Promise<void> {
    let delivered = 0;
    while (delivered < MAX_PACKETS_PER_POLL && this.inbound.length > 0 && !this.disposed) {
      const packet = this.inbound.shift();
      if (!packet) break;
      delivered += 1;
      this.receivedMeter.add(packet.data.byteLength);
      this.notifyPacket(packet.from, packet.channel, packet.data);
    }
  }

  protected recordSent(bytes: number): void {
    this.sentMeter.add(bytes);
  }

  public getStats(): NetworkStats {
    return {
      rttMs: 0,
      packetLossRate: 0,
      bytesSentPerSec: Math.round(this.sentMeter.perSecond()),
      bytesReceivedPerSec: Math.round(this.receivedMeter.perSecond()),
      activeConnections: this.linkPeers.size,
      transportType: this.type,
    };
  }

  public async broadcast(
    data: Uint8Array,
    channel: number,
    reliable: boolean,
  ): Promise<boolean> {
    if (this.linkPeers.size === 0) return false;
    let allSent = true;
    for (const peerId of Array.from(this.linkPeers)) {
      if (!(await this.send(peerId, data, channel, reliable))) allSent = false;
    }
    return allSent;
  }

  public override dispose(): void {
    this.inbound.length = 0;
    this.linkPeers.clear();
    super.dispose();
  }
}
