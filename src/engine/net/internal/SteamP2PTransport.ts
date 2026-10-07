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

function nowMs(): number {
  return performance.now();
}

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

  private lastStatsReset =
    nowMs();

  public constructor(
    private readonly steamApi:
      SteamApi,
  ) {
    super();
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

    for (
      let channel = 0;
      channel <
      STEAM_POLL_CHANNEL_COUNT;
      channel += 1
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
          continue;
        }

        this.bytesReceivedCount +=
          packet.bytesReceived;

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
    }
  }

  public getStats():
    NetworkStats {
    const now =
      nowMs();

    const elapsedSeconds =
      Math.max(
        0.001,
        (
          now -
          this.lastStatsReset
        ) /
          1000,
      );

    const attempts =
      this.successfulSendCount +
      this.rejectedSendCount;

    const stats:
      NetworkStats = {
        rttMs: 0,
        packetLossRate:
          attempts > 0
            ? this.rejectedSendCount /
              attempts
            : 0,
        bytesSentPerSec:
          Math.round(
            this.bytesSentCount /
              elapsedSeconds,
          ),
        bytesReceivedPerSec:
          Math.round(
            this.bytesReceivedCount /
              elapsedSeconds,
          ),
        activeConnections:
          this.activePeers.size,
        transportType:
          this.type,
      };

    if (
      elapsedSeconds >=
      1
    ) {
      this.bytesSentCount =
        0;

      this.bytesReceivedCount =
        0;

      this.successfulSendCount =
        0;

      this.rejectedSendCount =
        0;

      this.lastStatsReset =
        now;
    }

    return stats;
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
