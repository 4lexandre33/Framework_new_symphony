import type {
  NetworkStats,
  TransportType,
} from "../../../contracts/net/types";

import {
  isValidNetworkChannel,
  isValidNetworkPayload,
  isValidNetworkPeerId,
} from "./NetworkPacketValidator";

export interface PacketHandler {
  (
    senderId: string,
    channel: number,
    data: Uint8Array,
  ): void;
}

export interface PeerConnectionHandler {
  (peerId: string): void;
}

export interface PeerDisconnectionHandler {
  (
    peerId: string,
    reason: string,
  ): void;
}

export abstract class NetworkTransport {
  public abstract readonly type:
    TransportType;

  public abstract readonly isConnected:
    boolean;

  protected readonly packetHandlers =
    new Set<PacketHandler>();

  protected readonly peerConnectedHandlers =
    new Set<PeerConnectionHandler>();

  protected readonly peerDisconnectedHandlers =
    new Set<PeerDisconnectionHandler>();

  public abstract initialize():
    Promise<boolean>;

  public abstract connect(
    target: string,
  ): Promise<boolean>;

  public abstract disconnect():
    Promise<void>;

  public abstract send(
    targetId: string,
    data: Uint8Array,
    channel: number,
    reliable: boolean,
  ): Promise<boolean>;

  public abstract broadcast(
    data: Uint8Array,
    channel: number,
    reliable: boolean,
  ): Promise<boolean>;

  public abstract pollPackets():
    Promise<void>;

  public abstract getStats():
    NetworkStats;

  public onPacket(
    handler: PacketHandler,
  ): () => void {
    this.packetHandlers.add(
      handler,
    );

    return (): void => {
      this.packetHandlers.delete(
        handler,
      );
    };
  }

  public onPeerConnected(
    handler: PeerConnectionHandler,
  ): () => void {
    this.peerConnectedHandlers.add(
      handler,
    );

    return (): void => {
      this.peerConnectedHandlers.delete(
        handler,
      );
    };
  }

  public onPeerDisconnected(
    handler:
      PeerDisconnectionHandler,
  ): () => void {
    this.peerDisconnectedHandlers.add(
      handler,
    );

    return (): void => {
      this.peerDisconnectedHandlers.delete(
        handler,
      );
    };
  }

  protected canSendPacket(
    targetId: string,
    channel: number,
    data: Uint8Array,
  ): boolean {
    return (
      isValidNetworkPeerId(
        targetId,
      ) &&
      isValidNetworkChannel(
        channel,
      ) &&
      isValidNetworkPayload(
        data,
      )
    );
  }

  protected notifyPacket(
    senderId: string,
    channel: number,
    data: Uint8Array,
  ): boolean {
    if (
      !isValidNetworkPeerId(
        senderId,
      ) ||
      !isValidNetworkChannel(
        channel,
      ) ||
      !isValidNetworkPayload(
        data,
      )
    ) {
      return false;
    }

    for (
      const handler of
      this.packetHandlers
    ) {
      handler(
        senderId,
        channel,
        data,
      );
    }

    return true;
  }

  protected notifyPeerConnected(
    peerId: string,
  ): boolean {
    if (
      !isValidNetworkPeerId(
        peerId,
      )
    ) {
      return false;
    }

    for (
      const handler of
      this.peerConnectedHandlers
    ) {
      handler(peerId);
    }

    return true;
  }

  protected notifyPeerDisconnected(
    peerId: string,
    reason: string =
      "desconectado",
  ): boolean {
    if (
      !isValidNetworkPeerId(
        peerId,
      )
    ) {
      return false;
    }

    const normalizedReason =
      reason.trim().length > 0
        ? reason
        : "desconectado";

    for (
      const handler of
      this.peerDisconnectedHandlers
    ) {
      handler(
        peerId,
        normalizedReason,
      );
    }

    return true;
  }

  public dispose(): void {
    this.packetHandlers.clear();
    this.peerConnectedHandlers.clear();
    this.peerDisconnectedHandlers.clear();
  }
}
