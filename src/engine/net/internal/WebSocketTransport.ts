import type {
  NetworkStats,
  TransportType,
} from "../../../contracts/net/types";

import {
  NETWORK_BACKPRESSURE_HIGH_WATER_BYTES,
  isValidNetworkChannel,
  isValidNetworkPayload,
} from "./NetworkPacketValidator";

import {
  NetworkTransport,
} from "./NetworkTransport";

const DEDICATED_SERVER_PEER_ID =
  "dedicated_server";

const WEB_SOCKET_OPEN = 1;

function nowMs(): number {
  return performance.now();
}

function isSupportedWebSocketUrl(
  target: string,
): boolean {
  try {
    const url =
      new URL(target);

    return (
      url.protocol === "ws:" ||
      url.protocol === "wss:"
    );
  } catch {
    return false;
  }
}

export class WebSocketTransport
  extends NetworkTransport {
  public readonly type:
    TransportType =
      "websocket";

  private socket:
    WebSocket | null =
      null;

  private connected =
    false;

  private disposed =
    false;

  private connectionGeneration =
    0;

  private pendingConnectResolve:
    ((value: boolean) => void) | null =
      null;

  private bytesSentCount =
    0;

  private bytesReceivedCount =
    0;

  private rejectedSendCount =
    0;

  private successfulSendCount =
    0;

  private lastStatsReset =
    nowMs();

  public get isConnected():
    boolean {
    return (
      !this.disposed &&
      this.connected &&
      this.socket !== null &&
      this.socket.readyState ===
        WEB_SOCKET_OPEN
    );
  }

  public async initialize():
    Promise<boolean> {
    return !this.disposed;
  }

  public async connect(
    target: string,
  ): Promise<boolean> {
    if (
      this.disposed ||
      !isSupportedWebSocketUrl(
        target,
      )
    ) {
      return false;
    }

    if (this.isConnected) {
      return true;
    }

    this.closeSocket(
      false,
    );

    const generation =
      this.connectionGeneration +
      1;

    this.connectionGeneration =
      generation;

    return await new Promise<boolean>(
      (resolve) => {
        let settled =
          false;

        const settle = (
          value: boolean,
        ): void => {
          if (settled) {
            return;
          }

          settled = true;

          if (
            this.pendingConnectResolve ===
            settle
          ) {
            this.pendingConnectResolve =
              null;
          }

          resolve(value);
        };

        this.pendingConnectResolve =
          settle;

        try {
          const socket =
            new WebSocket(target);

          this.socket =
            socket;

          socket.binaryType =
            "arraybuffer";

          socket.onopen =
            (): void => {
              if (
                this.disposed ||
                generation !==
                  this.connectionGeneration ||
                this.socket !==
                  socket
              ) {
                socket.close();
                settle(false);
                return;
              }

              this.connected =
                true;

              this.notifyPeerConnected(
                DEDICATED_SERVER_PEER_ID,
              );

              settle(true);
            };

          socket.onmessage =
            (
              event:
                MessageEvent,
            ): void => {
              if (
                this.disposed ||
                generation !==
                  this.connectionGeneration ||
                this.socket !==
                  socket ||
                !(
                  event.data instanceof
                  ArrayBuffer
                )
              ) {
                return;
              }

              const data =
                new Uint8Array(
                  event.data,
                );

              if (
                !isValidNetworkPayload(
                  data,
                )
              ) {
                return;
              }

              this.bytesReceivedCount +=
                data.byteLength;

              this.notifyPacket(
                DEDICATED_SERVER_PEER_ID,
                0,
                data,
              );
            };

          socket.onerror =
            (): void => {
              if (
                generation !==
                  this.connectionGeneration ||
                this.socket !==
                  socket
              ) {
                return;
              }

              this.connected =
                false;

              settle(false);

              this.closeSocket(
                false,
              );
            };

          socket.onclose =
            (): void => {
              if (
                generation !==
                  this.connectionGeneration ||
                this.socket !==
                  socket
              ) {
                return;
              }

              const wasConnected =
                this.connected;

              this.connected =
                false;

              this.detachSocketHandlers(
                socket,
              );

              this.socket =
                null;

              if (wasConnected) {
                this.notifyPeerDisconnected(
                  DEDICATED_SERVER_PEER_ID,
                  "conexao_fechada",
                );
              }

              settle(false);
            };
        } catch {
          this.connected =
            false;

          this.socket =
            null;

          settle(false);
        }
      },
    );
  }

  public async disconnect():
    Promise<void> {
    this.closeSocket(
      true,
    );
  }

  public async send(
    targetId: string,
    data: Uint8Array,
    channel: number = 0,
    _reliable: boolean = true,
  ): Promise<boolean> {
    if (
      !this.isConnected ||
      !this.socket ||
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
      this.socket.bufferedAmount +
        data.byteLength >
      NETWORK_BACKPRESSURE_HIGH_WATER_BYTES
    ) {
      this.rejectedSendCount +=
        1;

      return false;
    }

    try {
      this.socket.send(data);

      this.bytesSentCount +=
        data.byteLength;

      this.successfulSendCount +=
        1;

      return true;
    } catch {
      this.rejectedSendCount +=
        1;

      return false;
    }
  }

  public async broadcast(
    data: Uint8Array,
    channel: number = 0,
    reliable: boolean = true,
  ): Promise<boolean> {
    if (
      !isValidNetworkChannel(
        channel,
      ) ||
      !isValidNetworkPayload(
        data,
      )
    ) {
      this.rejectedSendCount +=
        1;

      return false;
    }

    return await this.send(
      DEDICATED_SERVER_PEER_ID,
      data,
      channel,
      reliable,
    );
  }

  public async pollPackets():
    Promise<void> {
    // WebSocket entrega pacotes reativamente por onmessage.
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
          this.isConnected
            ? 1
            : 0,
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

    this.closeSocket(
      false,
    );

    super.dispose();
  }

  private closeSocket(
    notifyDisconnect: boolean,
  ): void {
    const pendingConnectResolve =
      this.pendingConnectResolve;

    this.pendingConnectResolve =
      null;

    pendingConnectResolve?.(
      false,
    );

    const socket =
      this.socket;

    const wasConnected =
      this.connected;

    this.connectionGeneration +=
      1;

    this.connected =
      false;

    this.socket =
      null;

    if (socket) {
      this.detachSocketHandlers(
        socket,
      );

      try {
        socket.close();
      } catch {
        // Fechamento é best-effort no teardown.
      }
    }

    if (
      notifyDisconnect &&
      wasConnected
    ) {
      this.notifyPeerDisconnected(
        DEDICATED_SERVER_PEER_ID,
        "desconexao_local",
      );
    }
  }

  private detachSocketHandlers(
    socket: WebSocket,
  ): void {
    socket.onopen =
      null;

    socket.onmessage =
      null;

    socket.onerror =
      null;

    socket.onclose =
      null;
  }
}
