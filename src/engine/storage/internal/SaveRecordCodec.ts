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
  return resolveSubtle() !== null;
}

/** HMAC-SHA256 em hex com prefixo de algoritmo. */
export async function computeHmac(
  key: string,
  content: string,
): Promise<string> {
  const subtle =
    resolveSubtle();

  if (!subtle) {
    throw storageError(
      "unavailable",
      "save",
      "WebCrypto indisponível: não é possível assinar o save.",
      false,
      "hmac-unavailable",
    );
  }

  const encoder =
    new TextEncoder();

  const cryptoKey =
    await subtle.importKey(
      "raw",
      encoder.encode(
        key,
      ),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );

  const digest =
    new Uint8Array(
      await subtle.sign(
        "HMAC",
        cryptoKey,
        encoder.encode(
          content,
        ),
      ),
    );

  let hex =
    "";

  for (
    let index =
      0;
    index <
    digest.length;
    index +=
      1
  ) {
    hex +=
      (digest[index] ?? 0)
        .toString(
          16,
        )
        .padStart(
          2,
          "0",
        );
  }

  return `hmac-sha256:${hex}`;
}
