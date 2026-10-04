import type {
  SteamApi,
} from "../../../tokens/steam";

import type {
  P2PSendType,
} from "../../../contracts/steam/net-types";

import type {
  NetworkStats,
  TransportType,
} from "../../../contracts/net/types";

import {
  NetworkTransport,
} from "./NetworkTransport";

export class SteamP2PTransport
  extends NetworkTransport {
  public readonly type:
    TransportType =
      "steam_p2p";

  private connected =
    false;

  private readonly activePeers =
    new Set<string>();

  private bytesSentCount =
    0;

  private bytesReceivedCount =
    0;

  private lastStatsReset =
    performance.now();

  public constructor(
    private readonly steamApi:
      SteamApi,
  ) {
    super();
  }

  public get isConnected():
    boolean {
    return (
      this.connected &&
      this.steamApi.isAvailable
    );
  }

  public async initialize():
    Promise<boolean> {
    this.connected =
      await this.steamApi
        .checkAvailability();

    return this.connected;
  }

  public async connect(
    targetSteamId: string,
  ): Promise<boolean> {
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
    for (
      const peerId of
      this.activePeers
    ) {
      this.notifyPeerDisconnected(
        peerId,
        "conexao_encerrada",
      );
    }

    this.activePeers.clear();

    this.connected =
      false;
  }

  public async send(
    targetId: string,
    data: Uint8Array,
    channel: number = 0,
    reliable: boolean = true,
  ): Promise<boolean> {
    if (!this.isConnected) {
      return false;
    }

    const sendType:
      P2PSendType =
        reliable
          ? "reliable"
          : "unreliableNoDelay";

    const sent =
      await this.steamApi
        .sendP2PPacket(
          targetId,
          data,
          sendType,
          channel,
        );

    if (!sent) {
      return false;
    }

    this.bytesSentCount +=
      data.byteLength;

    this.activePeers.add(
      targetId,
    );

    return true;
  }

  public async broadcast(
    data: Uint8Array,
    channel: number = 0,
    reliable: boolean = true,
  ): Promise<boolean> {
    if (
      !this.isConnected ||
      this.activePeers.size === 0
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
      channel < 2;
      channel += 1
    ) {
      let packet =
        await this.steamApi
          .readP2PPacket(
            channel,
          );

      while (
        packet !== null
      ) {
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

        packet =
          await this.steamApi
            .readP2PPacket(
              channel,
            );
      }
    }
  }

  public getStats():
    NetworkStats {
    const now =
      performance.now();

    const elapsedSeconds =
      Math.max(
        0.001,
        (
          now -
          this.lastStatsReset
        ) /
          1000,
      );

    const stats:
      NetworkStats = {
        rttMs: 15,
        packetLossRate: 0,
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

      this.lastStatsReset =
        now;
    }

    return stats;
  }
}