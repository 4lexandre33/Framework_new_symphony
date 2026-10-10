import type {
  SaveGameMetadata,
  SaveGameOptions,
} from "../../../contracts/storage/types";

import {
  StorageInfrastructureError,
  normalizeStorageError,
  storageError,
} from "./StorageErrors";

/**
 * v1: { formatVersion: 1, metadata, payload }.
 * v2: v1 + `signature` (HMAC opcional) — metadata pode trazer schemaVersion/label.
 * O decoder lê v1, v2 e o container legado ({ metadata, data }).
 */
const CURRENT_FORMAT_VERSION =
  2;

/** Tamanho máximo do nome do slot (o nome é codificado na chave). */
export const MAX_SLOT_NAME_LENGTH =
  256;

interface StoredSaveContainer {
  readonly formatVersion:
    1 | 2;

  readonly metadata:
    SaveGameMetadata;

  readonly payload:
    string;

  readonly signature?:
    string;
}

interface LegacyStoredSaveContainer {
  readonly metadata?:
    unknown;

  readonly data?:
    unknown;
}

export interface DecodedSaveRecord<
  T,
> {
  readonly metadata:
    SaveGameMetadata;

  readonly data:
    T;

  readonly migratedFromLegacy:
    boolean;

  /** Assinatura HMAC gravada (v2), se houver. */
  readonly signature?:
    string;

  /** Texto que a assinatura cobre (para verificação assíncrona). */
  readonly signingInput:
    string;
}

export type SlotOperation =
  | "save"
  | "load"
  | "list"
  | "delete";

/**
 * Slot válido: string com algo além de espaços e até 256 caracteres.
 * Qualquer caractere é aceito (a chave é codificada).
 */
export function assertSlotName(
  slotName: string,
  operation: SlotOperation = "save",
): void {
  if (
    typeof slotName !==
      "string" ||
    slotName.trim().length ===
      0 ||
    slotName.length >
      MAX_SLOT_NAME_LENGTH
  ) {
    throw storageError(
      "operation-failed",
      operation,
      `slotName inválido para persistência (não vazio, até ${String(MAX_SLOT_NAME_LENGTH)} caracteres).`,
      false,
      "invalid-slot",
    );
  }
}

function finiteNonNegative(
  value: unknown,
): number | undefined {
  return typeof value ===
      "number" &&
    Number.isFinite(
      value,
    ) &&
    value >=
      0
    ? value
    : undefined;
}

function nonEmptyString(
  value: unknown,
): string | undefined {
  return typeof value ===
      "string" &&
    value.trim().length >
      0
    ? value
    : undefined;
}

function legacyChecksum(
  content: string,
): string {
  let hash =
    0;

  for (
    let index =
      0;
    index <
    content.length;
    index +=
      1
  ) {
    const char =
      content.charCodeAt(
        index,
      );

    hash =
      (
        (
          hash <<
          5
        ) -
        hash +
        char
      ) |
      0;
  }

  return Math.abs(
    hash,
  ).toString(
    16,
  );
}

/**
 * FNV-1a 32-bit.
 *
 * É checksum de integridade (detecta corrupção acidental), não assinatura.
 * Para detectar adulteração use `integrityKey` (HMAC-SHA256). Nada no
 * cliente é confiável contra um jogador determinado: valide no servidor o
 * que for competitivo.
 */
export function calculateSaveChecksum(
  content: string,
): string {
  let hash =
    0x811c9dc5;

  for (
    let index =
      0;
    index <
    content.length;
    index +=
      1
  ) {
    hash ^=
      content.charCodeAt(
        index,
      );

    hash =
      Math.imul(
        hash,
        0x01000193,
      );
  }

  return `fnv1a32:${(
    hash >>>
    0
  )
    .toString(
      16,
    )
    .padStart(
      8,
      "0",
    )}`;
}

function serializePayload(
  data:
    Record<
      string,
      unknown
    >,
): string {
  try {
    const payload =
      JSON.stringify(
        data,
      );

    if (
      payload ===
        undefined
    ) {
      throw new TypeError(
        "Payload não serializável.",
      );
    }

    return payload;
  } catch (
    error
  ) {
    throw normalizeStorageError(
      error,
      "save",
      "Falha ao serializar payload de save.",
    );
  }
}

function parsePayload<
  T,
>(
  payload: string,
): T {
  try {
    return JSON.parse(
      payload,
    ) as T;
  } catch (
    error
  ) {
    throw new StorageInfrastructureError(
      "corrupted",
      "load",
      "Payload de save contém JSON inválido.",
      false,
      error,
    );
  }
}

export function isMetadata(
  value: unknown,
): value is SaveGameMetadata {
  if (
    typeof value !==
      "object" ||
    value ===
      null
  ) {
    return false;
  }

  const metadata =
    value as Partial<
      SaveGameMetadata
    >;

  return (
    typeof metadata.saveId ===
      "string" &&
    typeof metadata.slotName ===
      "string" &&
    typeof metadata.playTimeSeconds ===
      "number" &&
    Number.isFinite(
      metadata.playTimeSeconds,
    ) &&
    typeof metadata.timestamp ===
      "number" &&
    Number.isSafeInteger(
      metadata.timestamp,
    ) &&
    metadata.timestamp >=
      0 &&
    typeof metadata.gameVersion ===
      "string" &&
    typeof metadata.checksum ===
      "string" &&
    (metadata.schemaVersion ===
      undefined ||
      Number.isSafeInteger(
        metadata.schemaVersion,
      ))
  );
}

function verifyMetadata(
  metadata:
    SaveGameMetadata,
  expectedSlotName: string,
): void {
  if (
    metadata.slotName !==
      expectedSlotName
  ) {
    throw storageError(
      "corrupted",
      "load",
      `Save '${expectedSlotName}' contém metadata de outro slot.`,
      false,
      "slot-mismatch",
    );
  }
}

function verifyChecksum(
  checksum: string,
  payload: string,
  allowLegacy: boolean,
): void {
  const current =
    calculateSaveChecksum(
      payload,
    );

  if (
    checksum ===
      current
  ) {
    return;
  }

  if (
    allowLegacy &&
    checksum ===
      legacyChecksum(
        payload,
      )
  ) {
    return;
  }

  throw new StorageInfrastructureError(
    "corrupted",
    "load",
    "Checksum do save não corresponde ao payload persistido.",
    false,
  );
}

/** Texto coberto pela assinatura HMAC: slot, timestamp, schema e payload. */
export function buildSigningInput(
  metadata:
    SaveGameMetadata,
  payload: string,
): string {
  return `${metadata.slotName}\n${String(metadata.timestamp)}\n${String(metadata.schemaVersion ?? "")}\n${payload}`;
}

export interface PreparedSave {
  readonly metadata:
    SaveGameMetadata;

  readonly payload:
    string;

  readonly signingInput:
    string;
}

export interface SaveMetadataDefaults {
  readonly gameVersion?:
    string;

  readonly schemaVersion?:
    number;
}

/**
 * Monta metadata + payload. `playTimeSeconds`/`gameVersion` vêm de
 * `options`, depois do topo de `data` (compatibilidade) e por fim dos
 * padrões (G103).
 */
export function prepareSave(
  slotName: string,
  data:
    Record<
      string,
      unknown
    >,
  saveIdPrefix: string,
  timestamp: number,
  options?:
    SaveGameOptions,
  defaults?:
    SaveMetadataDefaults,
): PreparedSave {
  assertSlotName(
    slotName,
  );

  if (
    !Number.isSafeInteger(
      timestamp,
    ) ||
    timestamp <
      0
  ) {
    throw new StorageInfrastructureError(
      "operation-failed",
      "save",
      "Timestamp inválido ao criar save.",
      false,
    );
  }

  if (
    typeof data !==
      "object" ||
    data ===
      null
  ) {
    throw storageError(
      "operation-failed",
      "save",
      "data do save deve ser um objeto serializável em JSON.",
      false,
      "invalid-data",
    );
  }

  const payload =
    serializePayload(
      data,
    );

  const schemaVersion =
    options?.schemaVersion !==
      undefined &&
    Number.isSafeInteger(
      options.schemaVersion,
    )
      ? options.schemaVersion
      : defaults?.schemaVersion;

  const label =
    nonEmptyString(
      options?.label,
    );

  const metadata:
    SaveGameMetadata = {
      saveId:
        `${saveIdPrefix}_${slotName}_${String(timestamp)}`,

      slotName,

      playTimeSeconds:
        finiteNonNegative(
          options?.playTimeSeconds,
        ) ??
        finiteNonNegative(
          data.playTimeSeconds,
        ) ??
        0,

      timestamp,

      gameVersion:
        nonEmptyString(
          options?.gameVersion,
        ) ??
        nonEmptyString(
          data.gameVersion,
        ) ??
        defaults?.gameVersion ??
        "1.0.0",

      checksum:
        calculateSaveChecksum(
          payload,
        ),

      ...(schemaVersion !==
      undefined
        ? { schemaVersion }
        : {}),

      ...(label !==
      undefined
        ? { label }
        : {}),
    };

  return {
    metadata,
    payload,
    signingInput:
      buildSigningInput(
        metadata,
        payload,
      ),
  };
}

export function serializePreparedSave(
  prepared:
    PreparedSave,
  signature?:
    string,
): {
  readonly metadata:
    SaveGameMetadata;

  readonly serialized:
    string;
} {
  const metadata:
    SaveGameMetadata =
      signature !==
        undefined
        ? { ...prepared.metadata, signed: true }
        : prepared.metadata;

  const container:
    StoredSaveContainer = {
      formatVersion:
        CURRENT_FORMAT_VERSION,

      metadata,

      payload:
        prepared.payload,

      ...(signature !==
      undefined
        ? { signature }
        : {}),
    };

  return {
    metadata,

    serialized:
      JSON.stringify(
        container,
      ),
  };
}

/** Compatibilidade: cria o registro sem assinatura. */
export function createStoredSave(
  slotName: string,
  data:
    Record<
      string,
      unknown
    >,
  saveIdPrefix: string,
  timestamp: number,
  options?:
    SaveGameOptions,
): {
  readonly metadata:
    SaveGameMetadata;

  readonly serialized:
    string;
} {
  return serializePreparedSave(
    prepareSave(
      slotName,
      data,
      saveIdPrefix,
      timestamp,
      options,
    ),
  );
}

export function decodeStoredSave<
  T,
>(
  raw: string,
  expectedSlotName: string,
): DecodedSaveRecord<T> {
  let parsed:
    unknown;

  try {
    parsed =
      JSON.parse(
        raw,
      );
  } catch (
    error
  ) {
    throw new StorageInfrastructureError(
      "corrupted",
      "load",
      `Save '${expectedSlotName}' contém container JSON inválido.`,
      false,
      error,
    );
  }

  if (
    typeof parsed !==
      "object" ||
    parsed ===
      null
  ) {
    throw new StorageInfrastructureError(
      "corrupted",
      "load",
      `Save '${expectedSlotName}' possui container inválido.`,
      false,
    );
  }

  const candidate =
    parsed as {
      readonly formatVersion?:
        unknown;

      readonly metadata?:
        unknown;

      readonly payload?:
        unknown;

      readonly signature?:
        unknown;

      readonly data?:
        unknown;
    };

  if (
    candidate.formatVersion ===
      1 ||
    candidate.formatVersion ===
      2
  ) {
    if (
      !isMetadata(
        candidate.metadata,
      ) ||
      typeof candidate.payload !==
        "string" ||
      (candidate.signature !==
        undefined &&
        typeof candidate.signature !==
          "string")
    ) {
      throw new StorageInfrastructureError(
        "corrupted",
        "load",
        `Save '${expectedSlotName}' possui envelope v${String(candidate.formatVersion)} inválido.`,
        false,
      );
    }

    verifyMetadata(
      candidate.metadata,
      expectedSlotName,
    );

    verifyChecksum(
      candidate.metadata
        .checksum,
      candidate.payload,
      false,
    );

    return {
      metadata:
        candidate.metadata,

      data:
        parsePayload<T>(
          candidate.payload,
        ),

      migratedFromLegacy:
        false,

      ...(typeof candidate.signature ===
      "string"
        ? { signature: candidate.signature }
        : {}),

      signingInput:
        buildSigningInput(
          candidate.metadata,
          candidate.payload,
        ),
    };
  }

  const legacy =
    parsed as
      LegacyStoredSaveContainer;

  if (
    !isMetadata(
      legacy.metadata,
    ) ||
    !(
      "data" in
      legacy
    )
  ) {
    throw new StorageInfrastructureError(
      "corrupted",
      "load",
      `Save '${expectedSlotName}' possui formato desconhecido.`,
      false,
    );
  }

  verifyMetadata(
    legacy.metadata,
    expectedSlotName,
  );

  let legacyPayload:
    string;

  try {
    const serialized =
      JSON.stringify(
        legacy.data,
      );

    if (
      serialized ===
        undefined
    ) {
      throw new TypeError(
        "Payload legado não serializável.",
      );
    }

    legacyPayload =
      serialized;
  } catch (
    error
  ) {
    throw new StorageInfrastructureError(
      "corrupted",
      "load",
      `Save legado '${expectedSlotName}' não pode ser serializado.`,
      false,
      error,
    );
  }

  verifyChecksum(
    legacy.metadata
      .checksum,
    legacyPayload,
    true,
  );

  return {
    metadata:
      legacy.metadata,

    data:
      legacy.data as T,

    migratedFromLegacy:
      true,

    signingInput:
      buildSigningInput(
        legacy.metadata,
        legacyPayload,
      ),
  };
}

/** Lê só o slot gravado no registro (sem validar), ou null. */
export function peekStoredSlotName(
  raw: string,
): string | null {
  try {
    const parsed =
      JSON.parse(
        raw,
      ) as { metadata?: { slotName?: unknown } } | null;

    return typeof parsed?.metadata?.slotName ===
      "string"
      ? parsed.metadata.slotName
      : null;
  } catch {
    return null;
  }
}

export function encodeSlotName(
  slotName: string,
): string {
  return encodeURIComponent(
    slotName,
  );
}

export function makeStorageKey(
  prefix: string,
  slotName: string,
): string {
  assertSlotName(
    slotName,
  );

  return (
    prefix +
    encodeSlotName(
      slotName,
    )
  );
}

export function makeLegacyStorageKey(
  prefix: string,
  slotName: string,
): string {
  assertSlotName(
    slotName,
  );

  return (
    prefix +
    slotName
  );
}

/**
 * Chaves internas usam "#" logo após o prefixo: `encodeURIComponent` sempre
 * escapa "#", então não colidem com slots.
 */
export function makeBackupKey(
  prefix: string,
  slotName: string,
  index: number,
): string {
  return `${prefix}#bak${String(index)}:${encodeSlotName(slotName)}`;
}

export function makeIndexKey(
  prefix: string,
): string {
  return `${prefix}#index`;
}

export function isInternalKey(
  prefix: string,
  key: string,
): boolean {
  return key.startsWith(
    `${prefix}#`,
  );
}

/* ───────────────────────────── HMAC (WebCrypto) ───────────────────────── */

interface SubtleLike {
  importKey(
    format: "raw",
    keyData: Uint8Array,
    algorithm: { name: "HMAC"; hash: "SHA-256" },
    extractable: boolean,
    usages: string[],
  ): Promise<unknown>;

  sign(
    algorithm: "HMAC",
    key: unknown,
    data: Uint8Array,
  ): Promise<ArrayBuffer>;
}

function resolveSubtle(): SubtleLike | null {
  const cryptoApi =
    (
      globalThis as unknown as {
        readonly crypto?: { readonly subtle?: SubtleLike };
      }
    ).crypto;

  return cryptoApi?.subtle ?? null;
}

export function isHmacAvailable(): boolean {
  return true;
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 em JS puro (fallback quando WebCrypto não existe, ex.: contexto inseguro). */
function sha256(message: Uint8Array): Uint8Array {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const bitLength = message.length * 8;
  const paddedLength = (((message.length + 9) >> 6) + 1) << 6;
  const data = new Uint8Array(paddedLength);
  data.set(message);
  data[message.length] = 0x80;
  const view = new DataView(data.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const w = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const x = w[i - 15] ?? 0;
      const y = w[i - 2] ?? 0;
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = ((w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1) >>> 0;
    }

    let a = h[0] ?? 0;
    let b = h[1] ?? 0;
    let c = h[2] ?? 0;
    let d = h[3] ?? 0;
    let e = h[4] ?? 0;
    let f = h[5] ?? 0;
    let g = h[6] ?? 0;
    let hh = h[7] ?? 0;

    for (let i = 0; i < 64; i += 1) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + (SHA256_K[i] ?? 0) + (w[i] ?? 0)) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }

    h[0] = ((h[0] ?? 0) + a) >>> 0;
    h[1] = ((h[1] ?? 0) + b) >>> 0;
    h[2] = ((h[2] ?? 0) + c) >>> 0;
    h[3] = ((h[3] ?? 0) + d) >>> 0;
    h[4] = ((h[4] ?? 0) + e) >>> 0;
    h[5] = ((h[5] ?? 0) + f) >>> 0;
    h[6] = ((h[6] ?? 0) + g) >>> 0;
    h[7] = ((h[7] ?? 0) + hh) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i += 1) outView.setUint32(i * 4, h[i] ?? 0);
  return out;
}

/** HMAC-SHA256 em JS puro (RFC 2104). */
export function hmacSha256Fallback(key: Uint8Array, message: Uint8Array): Uint8Array {
  const block = new Uint8Array(64);
  block.set(key.length > 64 ? sha256(key) : key);
  const inner = new Uint8Array(64 + message.length);
  const outer = new Uint8Array(64 + 32);
  for (let i = 0; i < 64; i += 1) {
    const k = block[i] ?? 0;
    inner[i] = k ^ 0x36;
    outer[i] = k ^ 0x5c;
  }
  inner.set(message, 64);
  outer.set(sha256(inner), 64);
  return sha256(outer);
}

function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (let index = 0; index < bytes.length; index += 1) {
    hex += (bytes[index] ?? 0).toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * HMAC-SHA256 em hex com prefixo de algoritmo. Usa WebCrypto quando existe
 * (só em contexto seguro: https, localhost, Tauri); senão a implementação JS.
 */
export async function computeHmac(
  key: string,
  content: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const keyBytes = encoder.encode(key);
  const contentBytes = encoder.encode(content);
  const subtle = resolveSubtle();

  if (subtle) {
    try {
      const cryptoKey = await subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      return `hmac-sha256:${toHex(new Uint8Array(await subtle.sign("HMAC", cryptoKey, contentBytes)))}`;
    } catch {
      // cai para a implementação JS
    }
  }

  return `hmac-sha256:${toHex(hmacSha256Fallback(keyBytes, contentBytes))}`;
}
