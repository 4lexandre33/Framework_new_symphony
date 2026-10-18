/**
 * Acesso tipado ao pacote `ws` (dependência transitiva já instalada; o repo
 * não tem `@types/ws`). Carregado por `createRequire` para não exigir tipos
 * globais e para funcionar igual em tsx (stdio) e no vitest (node/jsdom).
 * Só o subconjunto usado pelo bridge e pelos testes está tipado.
 */

import { createRequire } from "node:module";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

export type WsRawData = Buffer | ArrayBuffer | Buffer[];

export interface WsSocket {
  readonly readyState: number;
  send(data: string, cb?: (error?: Error) => void): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  on(event: "message", listener: (data: WsRawData, isBinary: boolean) => void): this;
  on(event: "close", listener: (code: number, reason: Buffer) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "open", listener: () => void): this;
  once(event: "open" | "close", listener: (...args: unknown[]) => void): this;
  once(event: "error", listener: (error: Error) => void): this;
}

export interface WsVerifyInfo {
  readonly origin: string | undefined;
  readonly secure: boolean;
  readonly req: IncomingMessage;
}

export interface WsServerOptions {
  readonly host: string;
  readonly port: number;
  readonly maxPayload?: number;
  readonly perMessageDeflate?: boolean;
  readonly verifyClient?: (info: WsVerifyInfo) => boolean;
}

export interface WsServer {
  readonly clients: Set<WsSocket>;
  address(): AddressInfo | string | null;
  on(event: "connection", listener: (socket: WsSocket, req: IncomingMessage) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  once(event: "listening", listener: () => void): this;
  once(event: "error", listener: (error: NodeJS.ErrnoException) => void): this;
  off(event: string, listener: (...args: never[]) => void): this;
  close(cb?: (error?: Error) => void): void;
}

export interface WsModule {
  readonly WebSocketServer: new (options: WsServerOptions) => WsServer;
  readonly WebSocket: new (url: string, options?: { headers?: Record<string, string> }) => WsSocket;
}

export const WS_OPEN = 1;

let cached: WsModule | null = null;

/** Carrega `ws` uma vez. */
export function loadWs(): WsModule {
  if (cached) return cached;
  const require = createRequire(import.meta.url);
  cached = require("ws") as WsModule;
  return cached;
}

/** Converte o `data` de uma mensagem do `ws` em texto. */
export function rawToString(data: WsRawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return data.toString("utf8");
}
