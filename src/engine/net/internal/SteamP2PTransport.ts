import type {
  P2PSendType,
  SteamApi,
} from "../../steam/public";

import type {
  NetworkStats,
  TransportType,
} from "../../../contracts/net/types";

import {
  NETWORK_BACKPRESSURE_HIGH_WATER_BYTES,
  STEAM_MAX_PACKETS_PER_CHANNEL_PER_POLL,
  STEAM_POLL_CHANNEL_COUNT,
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

function nowMs(): number {
  return performance.now();
}

/** Limites de frame da sessão sobre Steam P2P (ISteamNetworking). */
export const STEAM_UNRELIABLE_FRAME_BYTES = 1_200;
export const STEAM_RELIABLE_FRAME_BYTES = 256 * 1024;
export const STEAM_MAX_PACKETS_PER_BATCH = 512;

export class SteamP2PTransport
  extends NetworkTransport {
  public readonly type:
    TransportType =
      "steam_p2p";

  private connected =
    false;

  private disposed =
    false;

  private readonly activePeers =
    new Set<string>();

  private bytesSentCount =
    0;

  private bytesReceivedCount =
    0;

  private pendingSendBytes =
    0;

  private rejectedSendCount =
    0;

  private successfulSendCount =
    0;

  private readonly sentMeter =
    new RateMeter(nowMs);

  private readonly receivedMeter =
    new RateMeter(nowMs);

  /** Canais usados em envios (fallback de leitura sem `readP2PPackets`). */
  private readonly knownChannels =
    new Set<number>([0, 1]);

  public constructor(
    private readonly steamApi:
      SteamApi,
  ) {
    super();
  }

  public override maxFrameBytes(
    reliable: boolean,
  ): number {
    return reliable
      ? STEAM_RELIABLE_FRAME_BYTES
      : STEAM_UNRELIABLE_FRAME_BYTES;
  }

  public override closePeer(
    peerId: string,
  ): void {
    this.activePeers.delete(
      peerId,
    );
  }

  public get isConnected():
    boolean {
    return (
      !this.disposed &&
      this.connected &&
      this.steamApi.isAvailable
    );
  }

  public async initialize():
    Promise<boolean> {
    if (this.disposed) {
      return false;
    }

    this.connected =
      await this.steamApi
        .checkAvailability();

    return this.connected;
  }

  public async connect(
    targetSteamId: string,
  ): Promise<boolean> {
    if (
      this.disposed ||
      !isValidNetworkPeerId(
        targetSteamId,
      )
    ) {
      return false;
    }

    if (!this.isConnected) {
      const initialized =
        await this.initialize();

      if (!initialized) {
        return false;
      }
    }

    const wasKnown =
      this.activePeers.has(
        targetSteamId,
      );

    this.activePeers.add(
      targetSteamId,
    );

    if (!wasKnown) {
      this.notifyPeerConnected(
        targetSteamId,
      );
    }

    return true;
  }

  public async disconnect():
    Promise<void> {
    this.disconnectAllPeers(
      "desconexao_local",
    );

    this.pendingSendBytes =
      0;

    this.connected =
      false;
  }

  public async send(
    targetId: string,
    data: Uint8Array,
    channel: number = 0,
    reliable: boolean = true,
  ): Promise<boolean> {
    if (
      !this.isConnected ||
      !this.canSendPacket(
        targetId,
        channel,
        data,
      )
    ) {
      this.rejectedSendCount +=
        1;

      return false;
    }

    if (
      this.pendingSendBytes +
        data.byteLength >
      NETWORK_BACKPRESSURE_HIGH_WATER_BYTES
    ) {
      this.rejectedSendCount +=
        1;

      return false;
    }

    const sendType:
      P2PSendType =
        reliable
          ? "reliable"
          : "unreliableNoDelay";

    this.pendingSendBytes +=
      data.byteLength;

    let sent =
      false;

    try {
      sent =
        await this.steamApi
          .sendP2PPacket(
            targetId,
            data,
            sendType,
            channel,
          );
    } catch {
      sent =
        false;
    } finally {
      this.pendingSendBytes =
        Math.max(
          0,
          this.pendingSendBytes -
            data.byteLength,
        );
    }

    if (!sent) {
      this.rejectedSendCount +=
        1;

      return false;
    }

    this.bytesSentCount +=
      data.byteLength;

    this.sentMeter.add(
      data.byteLength,
    );

    this.knownChannels.add(
      channel,
    );

    this.successfulSendCount +=
      1;

    const wasKnown =
      this.activePeers.has(
        targetId,
      );

    this.activePeers.add(
      targetId,
    );

    if (!wasKnown) {
      this.notifyPeerConnected(
        targetId,
      );
    }

    return true;
  }

  public async broadcast(
    data: Uint8Array,
    channel: number = 0,
    reliable: boolean = true,
  ): Promise<boolean> {
    if (
      !this.isConnected ||
      this.activePeers.size ===
        0 ||
      !isValidNetworkChannel(
        channel,
      ) ||
      !isValidNetworkPayload(
        data,
      )
    ) {
      return false;
    }

    let allSucceeded =
      true;

    for (
      const peerId of
      this.activePeers
    ) {
      const sent =
        await this.send(
          peerId,
          data,
          channel,
          reliable,
        );

      if (!sent) {
        allSucceeded =
          false;
      }
    }

    return allSucceeded;
  }

  public async pollPackets():
    Promise<void> {
    if (!this.isConnected) {
      return;
    }

    // G104: leitura em lote de TODOS os canais 0..255 quando disponível.
    if (
      typeof this.steamApi.readP2PPackets ===
      "function"
    ) {
      let packets:
        ReadonlyArray<
          Awaited<
            ReturnType<
              SteamApi["readP2PPacket"]
            >
          > & object
        >;

      try {
        packets =
          await this.steamApi.readP2PPackets(
            STEAM_MAX_PACKETS_PER_BATCH,
          );
      } catch {
        return;
      }

      for (
        const packet of
        packets
      ) {
        if (!this.isConnected) {
          return;
        }

        this.acceptIncoming(
          packet,
        );
      }

      return;
    }

    // Fallback (SteamApi sem leitura em lote): canais 0..STEAM_POLL_CHANNEL_COUNT-1
    // mais todo canal já usado em envios.
    for (
      let channel = 0;
      channel < STEAM_POLL_CHANNEL_COUNT;
      channel += 1
    ) {
      this.knownChannels.add(
        channel,
      );
    }

    for (
      const channel of
      Array.from(
        this.knownChannels,
      )
    ) {
      for (
        let packetIndex = 0;
        packetIndex <
        STEAM_MAX_PACKETS_PER_CHANNEL_PER_POLL;
        packetIndex += 1
      ) {
        if (!this.isConnected) {
          return;
        }

        let packet:
          Awaited<
            ReturnType<
              SteamApi["readP2PPacket"]
            >
          >;

        try {
          packet =
            await this.steamApi
              .readP2PPacket(
                channel,
              );
        } catch {
          break;
        }

        if (packet === null) {
          break;
        }

        this.acceptIncoming(
          packet,
        );
      }
    }
  }

  private acceptIncoming(
    packet: {
      readonly sourceSteamId: string;
      readonly channel: number;
      readonly data: Uint8Array;
      readonly bytesReceived: number;
    },
  ): void {
    if (
      !isValidNetworkPeerId(
        packet.sourceSteamId,
      ) ||
      !isValidNetworkChannel(
        packet.channel,
      ) ||
      !isValidNetworkPayload(
        packet.data,
      ) ||
      packet.bytesReceived <
        0 ||
      packet.bytesReceived >
        packet.data.byteLength
    ) {
      return;
    }

    this.bytesReceivedCount +=
      packet.bytesReceived;

    this.receivedMeter.add(
      packet.bytesReceived,
    );

    if (
      !this.activePeers.has(
        packet.sourceSteamId,
      )
    ) {
      this.activePeers.add(
        packet.sourceSteamId,
      );

      this.notifyPeerConnected(
        packet.sourceSteamId,
      );
    }

    this.notifyPacket(
      packet.sourceSteamId,
      packet.channel,
      packet.data,
    );
  }

  /**
   * Estatísticas do LINK (não destrutivo, G108). RTT e perda reais vêm da
   * sessão (`NetworkService.getStats()`, via ping/pong); aqui ficam 0.
   */
  public getStats():
    NetworkStats {
    return {
      rttMs: 0,
      packetLossRate: 0,
      bytesSentPerSec:
        Math.round(
          this.sentMeter.perSecond(),
        ),
      bytesReceivedPerSec:
        Math.round(
          this.receivedMeter.perSecond(),
        ),
      activeConnections:
        this.activePeers.size,
      transportType:
        this.type,
    };
  }

  /** Envios recusados (validação/backpressure/Steam) desde a criação. */
  public get rejectedSends(): number {
    return this.rejectedSendCount;
  }

  public get successfulSends(): number {
    return this.successfulSendCount;
  }

  public get totalBytesSent(): number {
    return this.bytesSentCount;
  }

  public get totalBytesReceived(): number {
    return this.bytesReceivedCount;
  }

  public override dispose():
    void {
    if (this.disposed) {
      return;
    }

    this.disposed =
      true;

    this.disconnectAllPeers(
      "transport_disposed",
    );

    this.pendingSendBytes =
      0;

    this.connected =
      false;

    super.dispose();
  }

  private disconnectAllPeers(
    reason: string,
  ): void {
    for (
      const peerId of
      this.activePeers
    ) {
      this.notifyPeerDisconnected(
        peerId,
        reason,
      );
    }

    this.activePeers.clear();
  }
}
