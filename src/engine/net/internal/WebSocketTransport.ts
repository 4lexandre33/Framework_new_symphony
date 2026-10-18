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
  type TransportListenOptions,
} from "./NetworkTransport";

import {
  decodeNativeWsHostEvents,
  tauriNativeWsHostBridge,
  type NativeWsHostBridge,
  type NativeWsHostError,
  type NativeWsHostInfo,
} from "./NativeWebSocketHostBridge";

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

/** Porta padrão do host WebSocket nativo. */
export const DEFAULT_WEBSOCKET_HOST_PORT =
  7777;

export interface WebSocketTransportOptions {
  /** Servidor nativo (G8); padrão: comandos Tauri `net_ws_host_*`. */
  readonly hostBridge?: NativeWsHostBridge;
}

/**
 * Transporte WebSocket.
 *
 * - CLIENTE (`connect("ws://…")`): fala com um host/relay do protocolo do
 *   `game.net`; o host aparece como o par `dedicated_server`.
 * - HOST (`listen`, só no app nativo — G8): o Rust abre um servidor
 *   WebSocket local/LAN (`net_ws_host_*`) e cada cliente vira o par
 *   `ws_<n>`; os eventos são drenados no `pollPackets` (pump da rede).
 */
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

  private readonly hostBridge:
    NativeWsHostBridge;

  /** Host nativo ativo (null = modo cliente/ocioso). */
  private hostInfo:
    NativeWsHostInfo | null =
      null;

  private readonly hostPeers =
    new Set<string>();

  private hostPollInFlight =
    false;

  private hostGeneration =
    0;

  private lastHostErrorValue:
    NativeWsHostError | null =
      null;

  public constructor(
    options: WebSocketTransportOptions = {},
  ) {
    super();
    this.hostBridge =
      options.hostBridge ??
      tauriNativeWsHostBridge;
  }

  /**
   * Só o app nativo hospeda (servidor WebSocket no Rust). No navegador o
   * WebSocket é só cliente: hospedar exige servidor externo.
   */
  public override get canHost(): boolean {
    return !this.disposed && this.hostBridge.isAvailable();
  }

  /**
   * Abre o servidor nativo: `port` (padrão 7777), `bind` `loopback`
   * (padrão, só esta máquina) ou `lan`, `maxClients` (1..250, padrão 16).
   */
  public override async listen(
    options: TransportListenOptions = {},
  ): Promise<boolean> {
    if (!this.canHost) {
      return false;
    }

    if (this.hostInfo !== null) {
      return true;
    }

    this.closeSocket(
      false,
    );

    const generation =
      this.hostGeneration +
      1;

    this.hostGeneration =
      generation;

    const port =
      options.port ??
      DEFAULT_WEBSOCKET_HOST_PORT;

    const bind =
      options.bind ??
      "loopback";

    const maxClients =
      options.maxClients ??
      16;

    try {
      let info: NativeWsHostInfo;

      try {
        info =
          await this.hostBridge.start(
            port,
            bind,
            maxClients,
          );
      } catch (error) {
        // O servidor nativo vive no processo Rust e sobrevive a um reload
        // do WebView: um `already-running` aqui é (quase sempre) o host
        // órfão da página anterior, que este transporte não conhece. Há
        // no máximo um host por app, então o derrubamos e tentamos UMA vez.
        if (
          toHostError(error).code !==
            "already-running" ||
          this.disposed ||
          generation !==
            this.hostGeneration
        ) {
          throw error;
        }

        await this.hostBridge.stop();

        if (
          this.disposed ||
          generation !==
            this.hostGeneration
        ) {
          return false;
        }

        info =
          await this.hostBridge.start(
            port,
            bind,
            maxClients,
          );
      }

      if (
        this.disposed ||
        generation !==
          this.hostGeneration
      ) {
        void this.hostBridge.stop().catch(() => false);
        return false;
      }

      this.hostInfo =
        info;

      this.lastHostErrorValue =
        null;

      return true;
    } catch (error) {
      this.lastHostErrorValue =
        toHostError(error);

      return false;
    }
  }

  /** Host nativo ativo: porta, bind e IP de LAN provável (null se não hospeda). */
  public getHostInfo():
    NativeWsHostInfo | null {
    return this.hostInfo;
  }

  /** Último erro do servidor nativo (ex.: `bind-failed` porta em uso). */
  public get lastHostError():
    NativeWsHostError | null {
    return this.lastHostErrorValue;
  }

  public get isHosting():
    boolean {
    return this.hostInfo !== null;
  }

  public get isConnected():
    boolean {
    if (this.hostInfo !== null) {
      return !this.disposed;
    }

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

    if (this.hostInfo !== null) {
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
    await this.stopHost(
      true,
      "desconexao_local",
    );

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
    if (this.hostInfo !== null) {
      return await this.hostSend(
        targetId,
        data,
        channel,
      );
    }

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

    if (this.hostInfo !== null) {
      return await this.hostSend(
        "*",
        data,
        channel,
      );
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
    // Cliente: entrega reativa por onmessage. Host nativo: drena a fila do Rust.
    if (
      this.hostInfo === null ||
      this.hostPollInFlight
    ) {
      return;
    }

    const generation =
      this.hostGeneration;

    this.hostPollInFlight =
      true;

    let buffer: ArrayBuffer;

    try {
      buffer =
        await this.hostBridge.poll();
    } catch (error) {
      this.hostPollInFlight =
        false;

      if (
        generation ===
          this.hostGeneration
      ) {
        // Servidor sumiu (ex.: `not-running`): todos os pares caem.
        this.lastHostErrorValue =
          toHostError(error);

        await this.stopHost(
          true,
          "host_parado",
          false,
        );
      }

      return;
    }

    this.hostPollInFlight =
      false;

    if (
      this.disposed ||
      generation !==
        this.hostGeneration
    ) {
      return;
    }

    decodeNativeWsHostEvents(
      buffer,
      this.hostEventSink,
    );
  }

  private readonly hostEventSink = {
    connected: (
      peerId: string,
    ): void => {
      if (this.hostPeers.has(peerId)) {
        return;
      }

      this.hostPeers.add(
        peerId,
      );

      this.notifyPeerConnected(
        peerId,
      );
    },

    disconnected: (
      peerId: string,
      reason: string,
    ): void => {
      if (!this.hostPeers.delete(peerId)) {
        return;
      }

      this.notifyPeerDisconnected(
        peerId,
        reason,
      );
    },

    message: (
      peerId: string,
      data: Uint8Array,
    ): void => {
      if (
        !this.hostPeers.has(peerId) ||
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
        peerId,
        0,
        data,
      );
    },
  };

  private async hostSend(
    targetId: string,
    data: Uint8Array,
    channel: number,
  ): Promise<boolean> {
    const broadcast =
      targetId === "*";

    if (
      !isValidNetworkChannel(
        channel,
      ) ||
      !isValidNetworkPayload(
        data,
      ) ||
      (broadcast
        ? this.hostPeers.size === 0
        : !this.hostPeers.has(targetId))
    ) {
      this.rejectedSendCount +=
        1;

      return false;
    }

    try {
      const accepted =
        await this.hostBridge.send(
          targetId,
          data,
        );

      if (!accepted) {
        this.rejectedSendCount +=
          1;

        return false;
      }

      const bytes =
        broadcast
          ? data.byteLength *
            this.hostPeers.size
          : data.byteLength;

      this.bytesSentCount +=
        bytes;

      this.sentMeter.add(
        bytes,
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

  public override closePeer(
    peerId: string,
  ): void {
    if (
      this.hostInfo === null ||
      !this.hostPeers.has(peerId)
    ) {
      return;
    }

    void this.hostBridge
      .closePeer(
        peerId,
      )
      .catch(
        () => false,
      );
  }

  /** Para o servidor nativo; com `notify` derruba os pares conhecidos. */
  private async stopHost(
    notify: boolean,
    reason: string,
    callNative = true,
  ): Promise<void> {
    if (this.hostInfo === null) {
      return;
    }

    this.hostInfo =
      null;

    this.hostGeneration +=
      1;

    this.hostPollInFlight =
      false;

    const peers =
      [...this.hostPeers];

    this.hostPeers.clear();

    if (notify) {
      for (const peerId of peers) {
        this.notifyPeerDisconnected(
          peerId,
          reason,
        );
      }
    }

    if (callNative) {
      try {
        await this.hostBridge.stop();
      } catch {
        // best-effort: o app também para o servidor ao sair.
      }
    }
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
        this.hostInfo !== null
          ? this.hostPeers.size
          : this.isConnected
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

    void this.stopHost(
      false,
      "dispose",
    );

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

function toHostError(
  error: unknown,
): NativeWsHostError {
  if (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    const native =
      error as { code: string; message?: unknown };

    return {
      code:
        native.code,
      message:
        typeof native.message === "string"
          ? native.message
          : native.code,
    };
  }

  return {
    code:
      "unavailable",
    message:
      error instanceof Error
        ? error.message
        : String(error),
  };
}
