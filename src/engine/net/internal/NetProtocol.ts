/**
 * Protocolo de sessão do `game.net` (v1), usado sobre QUALQUER transporte
 * (Steam P2P, WebSocket, loopback, BroadcastChannel).
 *
 * Cabeçalho de 4 bytes: [magic 0xA7, versão 1, tipo, canal do usuário].
 *
 * | tipo      | corpo                                                     |
 * |-----------|-----------------------------------------------------------|
 * | DATA      | payload do jogo                                           |
 * | FRAGMENT  | u32 messageId, u16 index, u16 count, u8 innerType, chunk  |
 * | HELLO     | JSON {protocol}                                           |
 * | WELCOME   | JSON {protocol, peerId}                                   |
 * | REJECT    | JSON {reason}                                             |
 * | PING/PONG | u32 seq, f64 sentAtMs                                     |
 * | BYE       | JSON {reason}                                             |
 * | SNAPSHOT  | JSON WorldStateSnapshot                                   |
 *
 * Inteiros em big-endian. Um servidor WebSocket precisa falar este protocolo
 * (responder HELLO com WELCOME e PING com PONG).
 */

import type {
  EntitySnapshot,
  WorldStateSnapshot,
} from "../../../contracts/net/types";

import { isValidEntitySnapshot } from "./NetworkPacketValidator";

export const NET_PROTOCOL_MAGIC = 0xa7;
export const NET_PROTOCOL_VERSION = 1;
export const NET_HEADER_BYTES = 4;
export const NET_FRAGMENT_HEADER_BYTES = NET_HEADER_BYTES + 9;
export const NET_PING_BYTES = NET_HEADER_BYTES + 12;
/** Maior mensagem lógica aceita (após remontagem). */
export const MAX_NET_MESSAGE_BYTES = 16 * 1024 * 1024;
export const MAX_NET_CONTROL_BYTES = 1024;
export const MAX_FRAGMENTS_PER_MESSAGE = 65_535;
export const MAX_SNAPSHOT_ENTITIES = 4096;

export const FRAME_DATA = 1;
export const FRAME_FRAGMENT = 2;
export const FRAME_HELLO = 3;
export const FRAME_WELCOME = 4;
export const FRAME_REJECT = 5;
export const FRAME_PING = 6;
export const FRAME_PONG = 7;
export const FRAME_BYE = 8;
export const FRAME_SNAPSHOT = 9;

export type NetFrame =
  | { readonly type: typeof FRAME_DATA; readonly channel: number; readonly payload: Uint8Array }
  | {
      readonly type: typeof FRAME_FRAGMENT;
      readonly channel: number;
      readonly messageId: number;
      readonly index: number;
      readonly count: number;
      readonly innerType: typeof FRAME_DATA | typeof FRAME_SNAPSHOT;
      readonly chunk: Uint8Array;
    }
  | { readonly type: typeof FRAME_HELLO; readonly protocol: number }
  | { readonly type: typeof FRAME_WELCOME; readonly protocol: number; readonly peerId: string }
  | { readonly type: typeof FRAME_REJECT; readonly reason: string }
  | { readonly type: typeof FRAME_PING; readonly seq: number; readonly sentAtMs: number }
  | { readonly type: typeof FRAME_PONG; readonly seq: number; readonly sentAtMs: number }
  | { readonly type: typeof FRAME_BYE; readonly reason: string }
  | { readonly type: typeof FRAME_SNAPSHOT; readonly payload: Uint8Array };

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

function header(type: number, channel: number, bodyBytes: number): Uint8Array {
  const frame = new Uint8Array(NET_HEADER_BYTES + bodyBytes);
  frame[0] = NET_PROTOCOL_MAGIC;
  frame[1] = NET_PROTOCOL_VERSION;
  frame[2] = type;
  frame[3] = channel & 0xff;
  return frame;
}

function encodeJson(type: number, value: unknown): Uint8Array {
  const body = textEncoder.encode(JSON.stringify(value));
  const frame = header(type, 0, body.byteLength);
  frame.set(body, NET_HEADER_BYTES);
  return frame;
}

function decodeJson(body: Uint8Array): Record<string, unknown> | null {
  if (body.byteLength > MAX_NET_CONTROL_BYTES) return null;
  try {
    const parsed = JSON.parse(textDecoder.decode(body)) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function sanitizeReason(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value.slice(0, 128) : "unknown";
}

export function encodeDataFrame(channel: number, payload: Uint8Array): Uint8Array {
  const frame = header(FRAME_DATA, channel, payload.byteLength);
  frame.set(payload, NET_HEADER_BYTES);
  return frame;
}

export function encodeSnapshotPayload(snapshot: WorldStateSnapshot): Uint8Array {
  return textEncoder.encode(JSON.stringify(snapshot));
}

export function encodeSnapshotFrame(payload: Uint8Array): Uint8Array {
  const frame = header(FRAME_SNAPSHOT, 0, payload.byteLength);
  frame.set(payload, NET_HEADER_BYTES);
  return frame;
}

export function encodeFragmentFrame(
  channel: number,
  messageId: number,
  index: number,
  count: number,
  innerType: typeof FRAME_DATA | typeof FRAME_SNAPSHOT,
  chunk: Uint8Array,
): Uint8Array {
  const frame = header(FRAME_FRAGMENT, channel, 9 + chunk.byteLength);
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  view.setUint32(NET_HEADER_BYTES, messageId >>> 0);
  view.setUint16(NET_HEADER_BYTES + 4, index);
  view.setUint16(NET_HEADER_BYTES + 6, count);
  view.setUint8(NET_HEADER_BYTES + 8, innerType);
  frame.set(chunk, NET_FRAGMENT_HEADER_BYTES);
  return frame;
}

export function encodeHelloFrame(): Uint8Array {
  return encodeJson(FRAME_HELLO, { protocol: NET_PROTOCOL_VERSION });
}

export function encodeWelcomeFrame(peerId: string): Uint8Array {
  return encodeJson(FRAME_WELCOME, { protocol: NET_PROTOCOL_VERSION, peerId });
}

export function encodeRejectFrame(reason: string): Uint8Array {
  return encodeJson(FRAME_REJECT, { reason });
}

export function encodeByeFrame(reason: string): Uint8Array {
  return encodeJson(FRAME_BYE, { reason });
}

function encodePingLike(type: number, seq: number, sentAtMs: number): Uint8Array {
  const frame = header(type, 0, 12);
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  view.setUint32(NET_HEADER_BYTES, seq >>> 0);
  view.setFloat64(NET_HEADER_BYTES + 4, sentAtMs);
  return frame;
}

export function encodePingFrame(seq: number, sentAtMs: number): Uint8Array {
  return encodePingLike(FRAME_PING, seq, sentAtMs);
}

export function encodePongFrame(seq: number, sentAtMs: number): Uint8Array {
  return encodePingLike(FRAME_PONG, seq, sentAtMs);
}

/** Decodifica um frame; `null` para qualquer coisa fora do protocolo. */
export function decodeFrame(data: Uint8Array): NetFrame | null {
  if (
    !(data instanceof Uint8Array) ||
    data.byteLength < NET_HEADER_BYTES ||
    data[0] !== NET_PROTOCOL_MAGIC ||
    data[1] !== NET_PROTOCOL_VERSION
  ) {
    return null;
  }

  const type = data[2] ?? 0;
  const channel = data[3] ?? 0;
  const body = data.subarray(NET_HEADER_BYTES);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  switch (type) {
    case FRAME_DATA:
      return { type: FRAME_DATA, channel, payload: body };
    case FRAME_SNAPSHOT:
      return { type: FRAME_SNAPSHOT, payload: body };
    case FRAME_FRAGMENT: {
      if (data.byteLength < NET_FRAGMENT_HEADER_BYTES) return null;
      const messageId = view.getUint32(NET_HEADER_BYTES);
      const index = view.getUint16(NET_HEADER_BYTES + 4);
      const count = view.getUint16(NET_HEADER_BYTES + 6);
      const innerType = view.getUint8(NET_HEADER_BYTES + 8);
      if (count < 2 || index >= count || (innerType !== FRAME_DATA && innerType !== FRAME_SNAPSHOT)) {
        return null;
      }
      return {
        type: FRAME_FRAGMENT,
        channel,
        messageId,
        index,
        count,
        innerType,
        chunk: data.subarray(NET_FRAGMENT_HEADER_BYTES),
      };
    }
    case FRAME_PING:
    case FRAME_PONG: {
      if (data.byteLength !== NET_PING_BYTES) return null;
      const seq = view.getUint32(NET_HEADER_BYTES);
      const sentAtMs = view.getFloat64(NET_HEADER_BYTES + 4);
      if (!Number.isFinite(sentAtMs)) return null;
      return type === FRAME_PING
        ? { type: FRAME_PING, seq, sentAtMs }
        : { type: FRAME_PONG, seq, sentAtMs };
    }
    case FRAME_HELLO: {
      const json = decodeJson(body);
      if (!json || json.protocol !== NET_PROTOCOL_VERSION) return null;
      return { type: FRAME_HELLO, protocol: NET_PROTOCOL_VERSION };
    }
    case FRAME_WELCOME: {
      const json = decodeJson(body);
      if (!json || json.protocol !== NET_PROTOCOL_VERSION || typeof json.peerId !== "string") return null;
      const peerId = json.peerId.trim();
      if (peerId.length === 0 || peerId.length > 128) return null;
      return { type: FRAME_WELCOME, protocol: NET_PROTOCOL_VERSION, peerId };
    }
    case FRAME_REJECT:
    case FRAME_BYE: {
      const json = decodeJson(body);
      const reason = sanitizeReason(json?.reason);
      return type === FRAME_REJECT ? { type: FRAME_REJECT, reason } : { type: FRAME_BYE, reason };
    }
    default:
      return null;
  }
}

/** Valida e normaliza um snapshot de mundo recebido. */
export function decodeSnapshotPayload(payload: Uint8Array): WorldStateSnapshot | null {
  if (payload.byteLength === 0 || payload.byteLength > MAX_NET_MESSAGE_BYTES) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(textDecoder.decode(payload));
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const entities = record.entities;

  if (
    !Number.isSafeInteger(record.sequence) ||
    (record.sequence as number) < 0 ||
    !Number.isSafeInteger(record.tick) ||
    typeof record.timestamp !== "number" ||
    !Number.isFinite(record.timestamp) ||
    typeof record.hostSteamId !== "string" ||
    record.hostSteamId.length > 128 ||
    !Array.isArray(entities) ||
    entities.length > MAX_SNAPSHOT_ENTITIES
  ) {
    return null;
  }

  const valid: EntitySnapshot[] = [];
  for (const entity of entities) {
    if (
      typeof entity === "object" &&
      entity !== null &&
      typeof (entity as EntitySnapshot).entityId === "string" &&
      typeof (entity as EntitySnapshot).type === "string" &&
      typeof (entity as EntitySnapshot).position === "object" &&
      typeof (entity as EntitySnapshot).rotation === "object" &&
      typeof (entity as EntitySnapshot).velocity === "object" &&
      (entity as EntitySnapshot).position !== null &&
      (entity as EntitySnapshot).rotation !== null &&
      (entity as EntitySnapshot).velocity !== null &&
      isValidEntitySnapshot(entity as EntitySnapshot)
    ) {
      valid.push(entity as EntitySnapshot);
    } else {
      return null;
    }
  }

  return {
    sequence: record.sequence as number,
    tick: record.tick as number,
    timestamp: record.timestamp,
    hostSteamId: record.hostSteamId,
    entities: valid,
  };
}
