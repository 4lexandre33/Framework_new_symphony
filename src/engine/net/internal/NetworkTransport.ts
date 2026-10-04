import type { TransportType, NetworkStats } from "../../../contracts/net/types";

export interface PacketHandler {
  (senderId: string, channel: number, data: Uint8Array): void;
}

export interface PeerConnectionHandler {
  (peerId: string): void;
}

export interface PeerDisconnectionHandler {
  (peerId: string, reason: string): void;
}

export abstract class NetworkTransport {
  abstract readonly type: TransportType;
  abstract readonly isConnected: boolean;

  protected readonly packetHandlers = new Set<PacketHandler>();
  protected readonly peerConnectedHandlers = new Set<PeerConnectionHandler>();
  protected readonly peerDisconnectedHandlers = new Set<PeerDisconnectionHandler>();

  abstract initialize(): Promise<boolean>;
  abstract connect(target: string): Promise<boolean>;
  abstract disconnect(): Promise<void>;
  abstract send(
    targetId: string,
    data: Uint8Array,
    channel: number,
    reliable: boolean
  ): Promise<boolean>;
  abstract broadcast(
    data: Uint8Array,
    channel: number,
    reliable: boolean
  ): Promise<boolean>;
  abstract pollPackets(): Promise<void>;
  abstract getStats(): NetworkStats;

  public onPacket(handler: PacketHandler): () => void {
    this.packetHandlers.add(handler);
    return () => {
      this.packetHandlers.delete(handler);
    };
  }

  public onPeerConnected(handler: PeerConnectionHandler): () => void {
    this.peerConnectedHandlers.add(handler);
    return () => {
      this.peerConnectedHandlers.delete(handler);
    };
  }

  public onPeerDisconnected(handler: PeerDisconnectionHandler): () => void {
    this.peerDisconnectedHandlers.add(handler);
    return () => {
      this.peerDisconnectedHandlers.delete(handler);
    };
  }

  protected notifyPacket(senderId: string, channel: number, data: Uint8Array): void {
    for (const handler of this.packetHandlers) {
      handler(senderId, channel, data);
    }
  }

  protected notifyPeerConnected(peerId: string): void {
    for (const handler of this.peerConnectedHandlers) {
      handler(peerId);
    }
  }

  protected notifyPeerDisconnected(peerId: string, reason: string = "desconectado"): void {
    for (const handler of this.peerDisconnectedHandlers) {
      handler(peerId, reason);
    }
  }

  public dispose(): void {
    this.packetHandlers.clear();
    this.peerConnectedHandlers.clear();
    this.peerDisconnectedHandlers.clear();
  }
}