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

import {
  RateMeter,
} from "./RateMeter";

/** Id do par "servidor" no transporte WebSocket (topologia estrela). */
export const DEDICATED_SERVER_PEER_ID =
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

  private readonly sentMeter =
    new RateMeter(nowMs);

  private readonly receivedMeter =
    new RateMeter(nowMs);

  /** WebSocket no navegador é só cliente: hospedar exige servidor externo. */
  public override get canHost(): boolean {
    return false;
  }

  public override async listen(): Promise<boolean> {
    return false;
  }

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

              this.receivedMeter.add(
                data.byteLength,
              );

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

              settle(false);

              // G105: erro depois de conectado é queda do par
              // (closeSocket notifica se estava conectado).
              this.closeSocket(
                true,
                "erro_conexao",
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
      targetId !==
        DEDICATED_SERVER_PEER_ID ||
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

      this.sentMeter.add(
        data.byteLength,
      );

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

  /** Estatísticas do link (não destrutivo). RTT/perda reais vêm da sessão. */
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
        this.isConnected
          ? 1
          : 0,
      transportType:
        this.type,
    };
  }

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

    this.closeSocket(
      false,
    );

    super.dispose();
  }

  private closeSocket(
    notifyDisconnect: boolean,
    reason = "desconexao_local",
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
        reason,
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
