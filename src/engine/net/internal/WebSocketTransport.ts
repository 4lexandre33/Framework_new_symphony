import type { TransportType, NetworkStats } from "../../../contracts/net/types";
import { NetworkTransport } from "./NetworkTransport";

export class WebSocketTransport extends NetworkTransport {
  readonly type: TransportType = "websocket";
  private socket: WebSocket | null = null;
  private connected = false;

  private bytesSentCount = 0;
  private bytesReceivedCount = 0;
  private lastStatsReset = performance.now();

  get isConnected(): boolean {
    return this.connected && this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  public async initialize(): Promise<boolean> {
    return true;
  }

  public async connect(url: string): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        this.socket = new WebSocket(url);
        this.socket.binaryType = "arraybuffer";

        this.socket.onopen = () => {
          this.connected = true;
          this.notifyPeerConnected("dedicated_server");
          resolve(true);
        };

        this.socket.onmessage = (event: MessageEvent) => {
          if (event.data instanceof ArrayBuffer) {
            const data = new Uint8Array(event.data);
            this.bytesReceivedCount += data.byteLength;
            this.notifyPacket("dedicated_server", 0, data);
          }
        };

        this.socket.onerror = (err) => {
          console.error("[WebSocketTransport] Erro no socket:", err);
          resolve(false);
        };

        this.socket.onclose = () => {
          this.connected = false;
          this.notifyPeerDisconnected("dedicated_server", "conexao_fechada");
        };
      } catch (err) {
        console.error("[WebSocketTransport] Falha ao instanciar WebSocket:", err);
        resolve(false);
      }
    });
  }

  public async disconnect(): Promise<void> {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.connected = false;
  }

  public async send(
    _targetId: string,
    data: Uint8Array,
    _channel: number = 0,
    _reliable: boolean = true
  ): Promise<boolean> {
    if (!this.isConnected || !this.socket) return false;

    this.socket.send(data.buffer);
    this.bytesSentCount += data.byteLength;
    return true;
  }

  public async broadcast(
    data: Uint8Array,
    channel: number = 0,
    reliable: boolean = true
  ): Promise<boolean> {
    return this.send("dedicated_server", data, channel, reliable);
  }

  public async pollPackets(): Promise<void> {
    // Processado de forma reativa via evento de mensagem do navegador
  }

  public getStats(): NetworkStats {
    const now = performance.now();
    const elapsedSec = Math.max(0.001, (now - this.lastStatsReset) / 1000);

    const stats: NetworkStats = {
      rttMs: 30,
      packetLossRate: 0.0,
      bytesSentPerSec: Math.round(this.bytesSentCount / elapsedSec),
      bytesReceivedPerSec: Math.round(this.bytesReceivedCount / elapsedSec),
      activeConnections: this.isConnected ? 1 : 0,
      transportType: this.type,
    };

    if (elapsedSec >= 1.0) {
      this.bytesSentCount = 0;
      this.bytesReceivedCount = 0;
      this.lastStatsReset = now;
    }

    return stats;
  }
}