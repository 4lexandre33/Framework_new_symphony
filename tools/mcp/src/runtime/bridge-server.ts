/**
 * Servidor WebSocket do DevBridge (lado MCP). O jogo em DEV é o CLIENTE
 * (src/debug/devbridge/DevBridge.ts) e conecta em `ws://127.0.0.1:<porta>`.
 *
 * - Só escuta em 127.0.0.1; recusa `Origin` de páginas fora de loopback.
 * - Tokens aleatórios (crypto): um principal (runtime_connect_info) + um por
 *   `runtime_launch` (assim a sessão do navegador lançado é identificada).
 *   Comparação em tempo constante (`devBridgeTokensEqual`).
 * - Handshake: o primeiro quadro tem de ser `hello` (protocolo 1) em até
 *   10 s; resposta `welcome {sessionId}` ou `reject {reason}` + close.
 * - Antes do hello: no máximo `MAX_PENDING_SOCKETS` conexões sem autenticar
 *   (as demais são recusadas no upgrade HTTP) e no máximo `PRE_HELLO_MAX_BYTES`
 *   recebidos por conexão (contados no socket TCP, antes de o `ws` montar a
 *   mensagem) — quem passa disso é derrubado. O limite grande de mensagem
 *   (`DEVBRIDGE_MAX_MESSAGE_BYTES`, screenshots) só vale para sessões aceitas.
 * - Várias sessões simultâneas, `sessionId` = `<projeto>-<n>`.
 * - Requisições com id e timeout por requisição; `ping` → `pong`.
 * - `dispose()` fecha tudo (requisições pendentes falham com NO_RUNTIME).
 */

import { randomBytes } from "node:crypto";
import type { AddressInfo, Socket } from "node:net";
import { McpToolError } from "../core/errors.ts";
import type { Logger } from "../core/log.ts";
import { silentLogger } from "../core/log.ts";
import {
  DEVBRIDGE_MAX_MESSAGE_BYTES,
  DEVBRIDGE_PROTOCOL_VERSION,
  devBridgeTokensEqual,
  parseDevBridgeMessage,
  type DevBridgeMethod,
  type HelloMessage,
} from "./protocol.ts";
import { loadWs, rawToString, WS_OPEN, type WsServer, type WsSocket } from "./ws.ts";

export const BRIDGE_HOST = "127.0.0.1";
export const DEFAULT_BRIDGE_TIMEOUT_MS = 15_000;
export const DEFAULT_SCREENSHOT_TIMEOUT_MS = 30_000;
export const HELLO_TIMEOUT_MS = 10_000;
export const MAX_SESSIONS = 32;
/** Conexões abertas que ainda não mandaram um `hello` válido. */
export const MAX_PENDING_SOCKETS = 8;
/** Bytes aceitos de uma conexão antes do `hello` (o hello real tem < 1 KiB). */
export const PRE_HELLO_MAX_BYTES = 64 * 1024;

/** Token aceito pelo DevBridge: 16..256 de [A-Za-z0-9_-.~]; base64url de 24 bytes = 32. */
export function newBridgeToken(): string {
  return randomBytes(24).toString("base64url");
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/**
 * `Origin` aceito: ausente (cliente Node/Tauri), `null`, `tauri://…` ou
 * http(s) em loopback / `*.localhost` (ex.: `http://tauri.localhost`).
 */
export function isAllowedOrigin(origin: string | undefined): boolean {
  if (origin === undefined || origin === "" || origin === "null") return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol === "tauri:") return true;
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return LOOPBACK_HOSTS.has(host) || host.endsWith(".localhost");
}

export interface BridgeTokenInfo {
  readonly token: string;
  /** `null` = token principal; senão o id do lançamento. */
  readonly launchId: string | null;
}

export interface BridgeSessionInfo {
  readonly sessionId: string;
  readonly project: string | null;
  readonly kernelApiVersion: string;
  readonly userAgent: string;
  readonly connectedAt: string;
  readonly uptimeMs: number;
  readonly launchId: string | null;
  readonly pendingRequests: number;
  readonly lastKernelStatus: string | null;
  readonly lastKernelStatusAt: string | null;
}

interface Pending {
  readonly method: string;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/** Erro devolvido pelo jogo (`res ok:false`). */
export class BridgeRemoteError extends Error {
  constructor(
    readonly bridgeCode: string,
    message: string,
    readonly method: string,
  ) {
    super(message);
    this.name = "BridgeRemoteError";
  }
}

export interface RequestOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export class BridgeSession {
  readonly sessionId: string;
  readonly project: string | null;
  readonly kernelApiVersion: string;
  readonly userAgent: string;
  readonly connectedAtMs = Date.now();
  readonly launchId: string | null;
  lastKernelStatus: string | null = null;
  lastKernelStatusAtMs: number | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private closed = false;
  private readonly closeListeners: Array<() => void> = [];

  constructor(
    private readonly socket: WsSocket,
    hello: HelloMessage,
    sessionId: string,
    launchId: string | null,
    private readonly defaultTimeoutMs: number,
  ) {
    this.sessionId = sessionId;
    this.project = hello.project;
    this.kernelApiVersion = hello.kernelApiVersion;
    this.userAgent = hello.userAgent.slice(0, 256);
    this.launchId = launchId;
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  info(): BridgeSessionInfo {
    return {
      sessionId: this.sessionId,
      project: this.project,
      kernelApiVersion: this.kernelApiVersion,
      userAgent: this.userAgent,
      connectedAt: new Date(this.connectedAtMs).toISOString(),
      uptimeMs: Date.now() - this.connectedAtMs,
      launchId: this.launchId,
      pendingRequests: this.pending.size,
      lastKernelStatus: this.lastKernelStatus,
      lastKernelStatusAt: this.lastKernelStatusAtMs === null ? null : new Date(this.lastKernelStatusAtMs).toISOString(),
    };
  }

  onClose(fn: () => void): void {
    if (this.closed) fn();
    else this.closeListeners.push(fn);
  }

  /** Envia `req` e espera `res` (timeout por requisição). */
  request<T = unknown>(method: DevBridgeMethod, params?: unknown, options: RequestOptions = {}): Promise<T> {
    if (this.closed || this.socket.readyState !== WS_OPEN) {
      return Promise.reject(noRuntime(`sessão ${this.sessionId} não está mais conectada`));
    }
    const id = this.nextId++;
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => {
        const p = this.pending.get(id);
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(id);
        reject(new McpToolError("TIMEOUT", `${method}: cancelado pelo cliente`));
      };
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        options.signal?.removeEventListener("abort", onAbort);
        reject(
          new McpToolError(
            "BRIDGE_TIMEOUT",
            `${method}: o jogo (${this.sessionId}) não respondeu em ${timeoutMs} ms`,
            "O jogo pode estar travado, em breakpoint ou com a aba em segundo plano. Veja runtime_status/logs_tail.",
            { method, timeoutMs, sessionId: this.sessionId },
          ),
        );
      }, timeoutMs);
      this.pending.set(id, {
        method,
        resolve: (v) => {
          options.signal?.removeEventListener("abort", onAbort);
          resolve(v as T);
        },
        reject: (e) => {
          options.signal?.removeEventListener("abort", onAbort);
          reject(e);
        },
        timer,
      });
      if (options.signal) {
        if (options.signal.aborted) {
          onAbort();
          return;
        }
        options.signal.addEventListener("abort", onAbort, { once: true });
      }
      this.socket.send(JSON.stringify({ type: "req", id, method, ...(params === undefined ? {} : { params }) }), (error) => {
        if (!error) return;
        const p = this.pending.get(id);
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(id);
        p.reject(noRuntime(`falha ao enviar ${method} para ${this.sessionId}: ${error.message}`));
      });
    });
  }

  /** Mensagem já validada vinda do jogo, depois do handshake. */
  handle(raw: string): void {
    const message = parseDevBridgeMessage(raw);
    if (message === null) return;
    if (message.type === "ping") {
      this.sendRaw({ type: "pong", ts: message.ts });
      return;
    }
    if (message.type !== "res") return;
    const id = typeof message.id === "number" ? message.id : Number(message.id);
    const p = this.pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(id);
    if (message.ok) p.resolve(message.result);
    else p.reject(new BridgeRemoteError(message.error.code, message.error.message, p.method));
  }

  sendRaw(message: unknown): void {
    if (this.closed || this.socket.readyState !== WS_OPEN) return;
    try {
      this.socket.send(JSON.stringify(message));
    } catch {
      /* socket fechando */
    }
  }

  /** Chamado quando o socket fecha (ou pelo servidor). */
  markClosed(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      this.pending.delete(id);
      p.reject(noRuntime(`sessão ${this.sessionId} desconectou durante ${p.method} (${reason})`));
    }
    for (const fn of this.closeListeners.splice(0)) {
      try {
        fn();
      } catch {
        /* ignora */
      }
    }
  }

  close(code = 1000, reason = "encerrado pelo MCP"): void {
    try {
      this.socket.close(code, reason);
    } catch {
      /* ignora */
    }
    // `terminate` garante que o close aconteça mesmo sem resposta do outro lado.
    setTimeout(() => {
      try {
        this.socket.terminate();
      } catch {
        /* ignora */
      }
    }, 500).unref();
    this.markClosed(reason);
  }
}

function noRuntime(message: string): McpToolError {
  return new McpToolError("NO_RUNTIME", message, "Use runtime_status para ver as sessões; runtime_launch ou runtime_connect_info para conectar um jogo.");
}

export interface BridgeServerOptions {
  /** Porta pedida (0 = livre). Se ocupada, cai para uma porta livre. */
  readonly port: number;
  readonly host?: string;
  readonly requestTimeoutMs?: number;
  readonly log?: Logger;
}

export interface BridgeListenInfo {
  readonly host: string;
  readonly port: number;
  readonly requestedPort: number;
  /** true se a porta pedida estava ocupada e outra foi escolhida. */
  readonly fallback: boolean;
  readonly url: string;
}

type SessionListener = (session: BridgeSession) => void;

export class BridgeServer {
  private wss: WsServer | null = null;
  private starting: Promise<BridgeListenInfo> | null = null;
  private listenInfo: BridgeListenInfo | null = null;
  private readonly sessions = new Map<string, BridgeSession>();
  private readonly tokens: BridgeTokenInfo[] = [];
  private readonly listeners = new Set<SessionListener>();
  private counter = 0;
  private pendingSockets = 0;
  private disposed = false;
  readonly mainToken: string;
  private readonly log: Logger;
  readonly requestTimeoutMs: number;

  constructor(private readonly options: BridgeServerOptions) {
    this.mainToken = newBridgeToken();
    this.tokens.push({ token: this.mainToken, launchId: null });
    this.log = options.log ?? silentLogger;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_BRIDGE_TIMEOUT_MS;
  }

  get listening(): BridgeListenInfo | null {
    return this.listenInfo;
  }

  /** Conexões ainda sem `hello` aceito (testes/diagnóstico). */
  get pendingCount(): number {
    return this.pendingSockets;
  }

  /** Inicia (uma vez) e devolve host/porta. */
  start(): Promise<BridgeListenInfo> {
    if (this.disposed) return Promise.reject(new McpToolError("INTERNAL", "servidor do bridge já foi encerrado"));
    this.starting ??= this.listen().catch((error: unknown) => {
      this.starting = null;
      throw error;
    });
    return this.starting;
  }

  private async listen(): Promise<BridgeListenInfo> {
    const host = this.options.host ?? BRIDGE_HOST;
    const requested = this.options.port;
    let wss: WsServer;
    let fallback = false;
    try {
      wss = await this.tryListen(host, requested);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (requested === 0 || (code !== "EADDRINUSE" && code !== "EACCES")) throw error;
      this.log.warn(`porta ${requested} do bridge ocupada (${code}); usando uma porta livre`);
      wss = await this.tryListen(host, 0);
      fallback = true;
    }
    if (this.disposed) {
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      throw new McpToolError("INTERNAL", "servidor do bridge encerrado durante a inicialização");
    }
    this.wss = wss;
    wss.on("connection", (socket, req) => this.onConnection(socket, req.socket.remoteAddress ?? "?", req.socket));
    wss.on("error", (error) => this.log.warn("erro no servidor do bridge", error));
    const port = (wss.address() as AddressInfo).port;
    this.listenInfo = { host, port, requestedPort: requested, fallback, url: `ws://${host}:${port}` };
    this.log.info(`DevBridge escutando em ${this.listenInfo.url}${fallback ? ` (porta ${requested} ocupada)` : ""}`);
    return this.listenInfo;
  }

  private tryListen(host: string, port: number): Promise<WsServer> {
    const { WebSocketServer } = loadWs();
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({
        host,
        port,
        maxPayload: DEVBRIDGE_MAX_MESSAGE_BYTES + 64 * 1024,
        perMessageDeflate: false,
        // Origin de loopback/tauri e limite de conexões pendentes (recusa no upgrade HTTP).
        verifyClient: (info) => isAllowedOrigin(info.origin) && this.pendingSockets < MAX_PENDING_SOCKETS,
      });
      const onError = (error: NodeJS.ErrnoException): void => {
        wss.close();
        reject(error);
      };
      wss.once("error", onError);
      wss.once("listening", () => {
        wss.off("error", onError as (...args: never[]) => void);
        resolve(wss);
      });
    });
  }

  /** Novo token para um lançamento (identifica a sessão do navegador lançado). */
  issueToken(launchId: string): string {
    const token = newBridgeToken();
    this.tokens.push({ token, launchId });
    return token;
  }

  revokeToken(token: string): void {
    const i = this.tokens.findIndex((t) => t.token === token);
    if (i > 0) this.tokens.splice(i, 1);
  }

  private matchToken(candidate: string): BridgeTokenInfo | null {
    let found: BridgeTokenInfo | null = null;
    // Compara com todos (sem sair cedo) para não vazar qual bateu.
    for (const t of this.tokens) {
      if (devBridgeTokensEqual(candidate, t.token) && found === null) found = t;
    }
    return found;
  }

  private onConnection(socket: WsSocket, remote: string, tcp?: Socket): void {
    let session: BridgeSession | null = null;
    if (this.pendingSockets >= MAX_PENDING_SOCKETS) {
      this.log.warn(`DevBridge recusado (${remote}): ${MAX_PENDING_SOCKETS} conexões aguardando hello`);
      socket.terminate();
      return;
    }
    this.pendingSockets += 1;
    let pending = true;
    let preHelloBytes = 0;
    const onTcpData = (chunk: Buffer): void => {
      preHelloBytes += chunk.length;
      if (preHelloBytes > PRE_HELLO_MAX_BYTES) {
        this.log.warn(`DevBridge recusado (${remote}): mais de ${PRE_HELLO_MAX_BYTES} bytes antes do hello`);
        tcp?.off("data", onTcpData);
        socket.terminate();
      }
    };
    tcp?.on("data", onTcpData);
    const leavePending = (): void => {
      if (!pending) return;
      pending = false;
      this.pendingSockets -= 1;
      tcp?.off("data", onTcpData);
    };
    const rejectAndClose = (reason: string): void => {
      this.log.warn(`DevBridge recusado (${remote}): ${reason}`);
      try {
        socket.send(JSON.stringify({ type: "reject", reason }));
      } catch {
        /* ignora */
      }
      try {
        socket.close(4001, reason.slice(0, 100));
      } catch {
        /* ignora */
      }
      setTimeout(() => socket.terminate(), 500).unref();
    };
    const helloTimer = setTimeout(() => rejectAndClose("hello não recebido a tempo"), HELLO_TIMEOUT_MS);
    helloTimer.unref();

    socket.on("error", (error) => this.log.debug(`erro no socket do DevBridge: ${error.message}`));
    socket.on("close", () => {
      clearTimeout(helloTimer);
      leavePending();
      if (session) {
        this.sessions.delete(session.sessionId);
        session.markClosed("socket fechado");
        this.log.info(`DevBridge desconectado: ${session.sessionId}`);
      }
    });
    socket.on("message", (data) => {
      const raw = rawToString(data);
      if (session) {
        session.handle(raw);
        return;
      }
      clearTimeout(helloTimer);
      if (raw.length > PRE_HELLO_MAX_BYTES) {
        rejectAndClose("hello grande demais");
        return;
      }
      const message = parseDevBridgeMessage(raw);
      if (message === null || message.type !== "hello") {
        rejectAndClose("a primeira mensagem deve ser hello");
        return;
      }
      if (message.protocol !== DEVBRIDGE_PROTOCOL_VERSION) {
        rejectAndClose(`protocolo ${message.protocol} incompatível (servidor ${DEVBRIDGE_PROTOCOL_VERSION})`);
        return;
      }
      const token = this.matchToken(message.token);
      if (token === null) {
        rejectAndClose("token inválido");
        return;
      }
      if (this.sessions.size >= MAX_SESSIONS) {
        rejectAndClose(`limite de ${MAX_SESSIONS} sessões atingido`);
        return;
      }
      if (message.project !== null && !/^[A-Za-z0-9_.-]{1,64}$/.test(message.project)) {
        rejectAndClose("project inválido no hello");
        return;
      }
      this.counter += 1;
      const sessionId = `${message.project ?? "sem-projeto"}-${this.counter}`;
      leavePending();
      session = new BridgeSession(socket, message, sessionId, token.launchId, this.requestTimeoutMs);
      this.sessions.set(sessionId, session);
      session.sendRaw({ type: "welcome", protocol: DEVBRIDGE_PROTOCOL_VERSION, sessionId });
      this.log.info(`DevBridge conectado: ${sessionId} (${remote})`);
      for (const fn of [...this.listeners]) {
        try {
          fn(session);
        } catch {
          /* ignora */
        }
      }
    });
  }

  list(): BridgeSession[] {
    return [...this.sessions.values()].filter((s) => s.isOpen);
  }

  get(sessionId: string): BridgeSession | null {
    const s = this.sessions.get(sessionId);
    return s && s.isOpen ? s : null;
  }

  /** Chama `fn` a cada sessão nova; devolve a função que cancela. */
  onSession(fn: SessionListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Espera uma sessão que satisfaça `pred` (já conectada ou futura). */
  waitForSession(pred: (s: BridgeSession) => boolean, timeoutMs: number, signal?: AbortSignal): Promise<BridgeSession | null> {
    const existing = this.list().find(pred);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve) => {
      let done = false;
      const finish = (value: BridgeSession | null): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        off();
        signal?.removeEventListener("abort", onAbort);
        resolve(value);
      };
      const onAbort = (): void => finish(null);
      const timer = setTimeout(() => finish(null), timeoutMs);
      const off = this.onSession((s) => {
        if (pred(s)) finish(s);
      });
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  /** Fecha uma sessão (o DevBridge do jogo tenta reconectar). */
  closeSession(sessionId: string, reason?: string): boolean {
    const s = this.sessions.get(sessionId);
    if (!s) return false;
    this.sessions.delete(sessionId);
    s.close(1000, reason);
    return true;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const s of [...this.sessions.values()]) s.close(1001, "servidor MCP encerrando");
    this.sessions.clear();
    this.listeners.clear();
    const wss = this.wss;
    this.wss = null;
    if (wss) {
      for (const c of wss.clients) {
        try {
          c.terminate();
        } catch {
          /* ignora */
        }
      }
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    } else if (this.starting) {
      await this.starting.catch(() => undefined);
    }
  }
}
