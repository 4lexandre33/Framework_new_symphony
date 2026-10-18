import {
  invoke,
} from "@tauri-apps/api/core";

/** Espelho de `WsHostInfoDto` (src-tauri/src/net_ws_host.rs). */
export interface NativeWsHostInfo {
  readonly running: boolean;
  readonly port: number;
  readonly bind: string;
  readonly maxClients: number;
  readonly peers: number;
  readonly lanAddress: string | null;
}

/** Erro serializado `{ code, message }` dos comandos `net_ws_host_*`. */
export interface NativeWsHostError {
  readonly code: string;
  readonly message: string;
}

export type NativeWsHostBind = "loopback" | "lan";

/**
 * Ponte para o servidor WebSocket nativo (G8). Injetável para testes; a
 * padrão usa os comandos Tauri e só existe no app nativo.
 */
export interface NativeWsHostBridge {
  isAvailable(): boolean;
  start(port: number, bind: NativeWsHostBind, maxClients: number): Promise<NativeWsHostInfo>;
  stop(): Promise<boolean>;
  /** Eventos codificados (veja `decodeNativeWsHostEvents`). */
  poll(): Promise<ArrayBuffer>;
  /** `peerId` = `ws_<n>` ou `*` (broadcast). `false` = backpressure/par ausente. */
  send(peerId: string, data: Uint8Array): Promise<boolean>;
  closePeer(peerId: string): Promise<boolean>;
}

function isTauriRuntime(): boolean {
  return (
    typeof (globalThis as { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__ === "object"
  );
}

function exactBytes(data: Uint8Array): Uint8Array {
  // O IPC cru envia o buffer inteiro: garante uma vista sem deslocamento.
  return data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
    ? data
    : data.slice();
}

export const tauriNativeWsHostBridge: NativeWsHostBridge = {
  isAvailable: isTauriRuntime,
  start: (port, bind, maxClients) =>
    invoke<NativeWsHostInfo>("net_ws_host_start", { port, bind, maxClients }),
  stop: () =>
    invoke<boolean>("net_ws_host_stop"),
  poll: () =>
    invoke<ArrayBuffer>("net_ws_host_poll"),
  send: (peerId, data) =>
    invoke<boolean>("net_ws_host_send", exactBytes(data), {
      headers: { "x-peer-id": peerId },
    }),
  closePeer: (peerId) =>
    invoke<boolean>("net_ws_host_close_peer", { peerId }),
};

export const NATIVE_WS_EVENT_CONNECTED = 1;
export const NATIVE_WS_EVENT_DISCONNECTED = 2;
export const NATIVE_WS_EVENT_MESSAGE = 3;

export interface NativeWsHostEventSink {
  connected(peerId: string): void;
  disconnected(peerId: string, reason: string): void;
  message(peerId: string, data: Uint8Array): void;
}

const textDecoder = new TextDecoder();

/**
 * `[tipo u8][len id u8][id][len u32 BE][corpo]` repetido. Entrada malformada
 * interrompe a decodificação (o resto é descartado) e devolve `false`.
 */
export function decodeNativeWsHostEvents(
  buffer: ArrayBuffer | Uint8Array,
  sink: NativeWsHostEventSink,
): boolean {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;

  while (offset < bytes.byteLength) {
    if (offset + 2 > bytes.byteLength) return false;
    const kind = bytes[offset];
    const idLength = bytes[offset + 1];
    offset += 2;

    if (idLength === 0 || offset + idLength + 4 > bytes.byteLength) return false;
    const peerId = textDecoder.decode(bytes.subarray(offset, offset + idLength));
    offset += idLength;

    const bodyLength = view.getUint32(offset, false);
    offset += 4;

    if (offset + bodyLength > bytes.byteLength) return false;
    const body = bytes.subarray(offset, offset + bodyLength);
    offset += bodyLength;

    if (kind === NATIVE_WS_EVENT_CONNECTED) {
      sink.connected(peerId);
    } else if (kind === NATIVE_WS_EVENT_DISCONNECTED) {
      sink.disconnected(peerId, textDecoder.decode(body));
    } else if (kind === NATIVE_WS_EVENT_MESSAGE) {
      // Cópia: o buffer do IPC pode ser reaproveitado pelo chamador.
      sink.message(peerId, body.slice());
    } else {
      return false;
    }
  }

  return true;
}
