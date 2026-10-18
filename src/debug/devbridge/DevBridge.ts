/**
 * Cliente WebSocket do DevBridge (o jogo conecta no servidor MCP local).
 * Handshake com token, tabela fechada de métodos, heartbeat e reconexão com
 * backoff (até 10 s). Nunca lança para dentro do jogo.
 */
import {
  DEVBRIDGE_HEARTBEAT_MS,
  DEVBRIDGE_HEARTBEAT_TIMEOUT_MS,
  DEVBRIDGE_MAX_MESSAGE_BYTES,
  DEVBRIDGE_MAX_RESULT_BYTES,
  DEVBRIDGE_PROTOCOL_VERSION,
  DEVBRIDGE_RECONNECT_MAX_MS,
  DEVBRIDGE_RECONNECT_MIN_MS,
  isDevBridgeMethod,
  isLoopbackDevBridgeUrl,
  parseDevBridgeMessage,
  type DevBridgeError,
  type HelloMessage,
  type RequestMessage,
  type ResponseMessage,
} from "./protocol";
import { DevBridgeMethodError, type DevBridgeMethodTable } from "./methods";

/** Subconjunto do WebSocket do DOM usado aqui (o pacote `ws` também serve). */
export interface DevBridgeSocket {
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type DevBridgeSocketFactory = new (url: string) => DevBridgeSocket;

export type DevBridgeState = "idle" | "connecting" | "handshake" | "ready" | "rejected" | "stopped";

export interface DevBridgeLogger {
  info(message: string, ...rest: unknown[]): void;
  warn(message: string, ...rest: unknown[]): void;
}

export interface DevBridgeOptions {
  readonly url: string;
  readonly token: string;
  readonly project: string | null;
  readonly kernelApiVersion: string;
  readonly methods: DevBridgeMethodTable;
  /** Padrão: `globalThis.WebSocket`. */
  readonly WebSocketImpl?: DevBridgeSocketFactory;
  readonly userAgent?: string;
  readonly logger?: DevBridgeLogger;
  readonly reconnectMinMs?: number;
  readonly reconnectMaxMs?: number;
  readonly heartbeatMs?: number;
  readonly heartbeatTimeoutMs?: number;
  readonly onStateChange?: (state: DevBridgeState) => void;
}

const WS_OPEN = 1;

/** Métodos cujo resultado pode passar de DEVBRIDGE_MAX_RESULT_BYTES. */
const LARGE_RESULT_METHODS: readonly string[] = ["screenshot", "world.snapshot"];

export class DevBridge {
  private socket: DevBridgeSocket | null = null;
  private currentState: DevBridgeState = "idle";
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private backoffMs: number;
  private lastSeenMs = 0;
  private attempts = 0;
  private readonly socketFactory: DevBridgeSocketFactory | null;
  private readonly logger: DevBridgeLogger;

  public constructor(private readonly options: DevBridgeOptions) {
    this.backoffMs = options.reconnectMinMs ?? DEVBRIDGE_RECONNECT_MIN_MS;
    this.socketFactory =
      options.WebSocketImpl ??
      ((globalThis as unknown as { WebSocket?: DevBridgeSocketFactory }).WebSocket ?? null);
    this.logger = options.logger ?? {
      info: (message, ...rest) => console.info(`[DevBridge] ${message}`, ...rest),
      warn: (message, ...rest) => console.warn(`[DevBridge] ${message}`, ...rest),
    };
  }

  public get state(): DevBridgeState {
    return this.currentState;
  }

  /** Número de tentativas de conexão feitas (para diagnóstico/testes). */
  public get connectionAttempts(): number {
    return this.attempts;
  }

  public start(): void {
    if (this.currentState !== "idle") return;
    if (!isLoopbackDevBridgeUrl(this.options.url)) {
      this.logger.warn(`URL recusada (só ws:// em 127.0.0.1/localhost/[::1]): ${this.options.url}`);
      this.setState("stopped");
      return;
    }
    if (this.socketFactory === null) {
      this.logger.warn("WebSocket indisponível neste ambiente.");
      this.setState("stopped");
      return;
    }
    this.connect();
  }

  public stop(): void {
    if (this.currentState === "stopped") return;
    this.setState("stopped");
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    if (socket !== null) this.detach(socket, true);
  }

  // ── conexão ────────────────────────────────────────────────────────────

  private setState(state: DevBridgeState): void {
    if (this.currentState === state) return;
    this.currentState = state;
    try {
      this.options.onStateChange?.(state);
    } catch {
      // ignora
    }
  }

  private connect(): void {
    if (this.currentState === "stopped" || this.currentState === "rejected") return;
    this.setState("connecting");
    this.attempts += 1;
    let socket: DevBridgeSocket;
    try {
      socket = new (this.socketFactory as DevBridgeSocketFactory)(this.options.url);
    } catch (error) {
      this.logger.warn("falha ao abrir WebSocket", error);
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.setState("handshake");
      this.lastSeenMs = Date.now();
      const hello: HelloMessage = {
        type: "hello",
        protocol: DEVBRIDGE_PROTOCOL_VERSION,
        token: this.options.token,
        project: this.options.project,
        kernelApiVersion: this.options.kernelApiVersion,
        userAgent: this.options.userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "desconhecido"),
      };
      this.sendRaw(socket, hello);
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      this.lastSeenMs = Date.now();
      void this.handleMessage(socket, event.data);
    };
    socket.onerror = () => {
      // o close que vem em seguida agenda a reconexão
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.stopHeartbeat();
      if (this.currentState === "stopped" || this.currentState === "rejected") return;
      this.scheduleReconnect();
    };
  }

  private detach(socket: DevBridgeSocket, close: boolean): void {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = () => {};
    if (close) {
      try {
        socket.close(1000, "devbridge parado");
      } catch {
        // ignora
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.currentState === "stopped" || this.currentState === "rejected") return;
    this.setState("connecting");
    if (this.reconnectTimer !== null) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, this.options.reconnectMaxMs ?? DEVBRIDGE_RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private startHeartbeat(socket: DevBridgeSocket): void {
    this.stopHeartbeat();
    const interval = this.options.heartbeatMs ?? DEVBRIDGE_HEARTBEAT_MS;
    const timeout = this.options.heartbeatTimeoutMs ?? DEVBRIDGE_HEARTBEAT_TIMEOUT_MS;
    this.heartbeatTimer = setInterval(() => {
      if (this.socket !== socket) return;
      if (Date.now() - this.lastSeenMs > timeout) {
        this.logger.warn("servidor MCP sem resposta; reconectando");
        try {
          socket.close(4000, "heartbeat");
        } catch {
          // ignora
        }
        // alguns ambientes não emitem close após close(): força o ciclo
        this.socket = null;
        this.detach(socket, false);
        this.stopHeartbeat();
        this.scheduleReconnect();
        return;
      }
      this.sendRaw(socket, { type: "ping", ts: Date.now() });
    }, interval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearTimers(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private sendRaw(socket: DevBridgeSocket, message: unknown): boolean {
    if (socket.readyState !== WS_OPEN) return false;
    try {
      socket.send(JSON.stringify(message));
      return true;
    } catch (error) {
      this.logger.warn("falha ao enviar mensagem", error);
      return false;
    }
  }

  // ── mensagens ──────────────────────────────────────────────────────────

  private async handleMessage(socket: DevBridgeSocket, data: unknown): Promise<void> {
    try {
      const text = typeof data === "string" ? data : String(data);
      const message = parseDevBridgeMessage(text);
      if (message === null) {
        this.logger.warn("mensagem inválida ignorada");
        return;
      }
      switch (message.type) {
        case "welcome":
          if (this.currentState !== "handshake") return;
          if (message.protocol !== DEVBRIDGE_PROTOCOL_VERSION) {
            this.reject(socket, `protocolo ${message.protocol} incompatível (cliente ${DEVBRIDGE_PROTOCOL_VERSION})`);
            return;
          }
          this.backoffMs = this.options.reconnectMinMs ?? DEVBRIDGE_RECONNECT_MIN_MS;
          this.setState("ready");
          this.logger.info(`conectado a ${this.options.url}`);
          this.startHeartbeat(socket);
          return;
        case "reject":
          this.reject(socket, message.reason);
          return;
        case "ping":
          this.sendRaw(socket, { type: "pong", ts: message.ts });
          return;
        case "pong":
          return;
        case "req":
          await this.handleRequest(socket, message);
          return;
        default:
          return;
      }
    } catch (error) {
      this.logger.warn("erro ao tratar mensagem", error);
    }
  }

  private reject(socket: DevBridgeSocket, reason: string): void {
    this.logger.warn(`conexão recusada pelo servidor MCP: ${reason}`);
    this.setState("rejected");
    this.clearTimers();
    if (this.socket === socket) this.socket = null;
    this.detach(socket, true);
  }

  private async handleRequest(socket: DevBridgeSocket, request: RequestMessage): Promise<void> {
    const respondError = (error: DevBridgeError): void => {
      const response: ResponseMessage = { type: "res", id: request.id, ok: false, error };
      this.sendRaw(socket, response);
    };

    if (this.currentState !== "ready") {
      respondError({ code: "BAD_MESSAGE", message: "handshake não concluído" });
      return;
    }
    if (!isDevBridgeMethod(request.method)) {
      respondError({ code: "UNKNOWN_METHOD", message: `método desconhecido: ${request.method}` });
      return;
    }

    let result: unknown;
    try {
      result = await this.options.methods[request.method](request.params);
    } catch (error) {
      if (error instanceof DevBridgeMethodError) {
        respondError({ code: error.code, message: error.message });
      } else {
        respondError({ code: "METHOD_FAILED", message: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    let text: string;
    try {
      text = JSON.stringify({ type: "res", id: request.id, ok: true, result: result === undefined ? null : result });
    } catch (error) {
      respondError({ code: "METHOD_FAILED", message: `resultado não serializável: ${String(error)}` });
      return;
    }
    const limit = LARGE_RESULT_METHODS.includes(request.method) ? DEVBRIDGE_MAX_MESSAGE_BYTES : DEVBRIDGE_MAX_RESULT_BYTES;
    if (text.length > limit) {
      respondError({
        code: "RESULT_TOO_LARGE",
        message: `resultado de ${request.method} tem ${text.length} bytes (limite ${limit}); use limit/maxWidth menores`,
      });
      return;
    }
    if (socket.readyState !== WS_OPEN) return;
    try {
      socket.send(text);
    } catch (error) {
      this.logger.warn("falha ao enviar resposta", error);
    }
  }
}
