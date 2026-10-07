import type {
  SaveGameMetadata,
} from "../../../contracts/storage/types";

import {
  StorageInfrastructureError,
  normalizeStorageError,
} from "./StorageErrors";

const CURRENT_FORMAT_VERSION =
  1;

interface StoredSaveContainerV1 {
  readonly formatVersion:
    1;

  readonly metadata:
    SaveGameMetadata;

  readonly payload:
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
}

function assertSlotName(
  slotName: string,
): void {
  if (
    slotName.trim().length ===
      0 ||
    slotName.length >
      128 ||
    /[\u0000-\u001f\u007f]/u.test(
      slotName,
    )
  ) {
    throw new StorageInfrastructureError(
      "operation-failed",
      "save",
      "slotName inválido para persistência.",
      false,
    );
  }
}

function readPlayTimeSeconds(
  data:
    Record<
      string,
      unknown
    >,
): number {
  const value =
    data.playTimeSeconds;

  if (
    typeof value ===
      "number" &&
    Number.isFinite(
      value,
    ) &&
    value >=
      0
  ) {
    return value;
  }

  return 0;
}

function readGameVersion(
  data:
    Record<
      string,
      unknown
    >,
): string {
  const value =
    data.gameVersion;

  if (
    typeof value ===
      "string" &&
    value.trim().length >
      0
  ) {
    return value;
  }

  return "1.0.0";
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
 * É checksum de integridade, não assinatura criptográfica. O formato inclui
 * o prefixo do algoritmo para permitir upgrades compatíveis no futuro.
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

function isMetadata(
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
      "string"
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
    throw new StorageInfrastructureError(
      "corrupted",
      "load",
      `Save '${expectedSlotName}' contém metadata de outro slot.`,
      false,
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

export function createStoredSave(
  slotName: string,
  data:
    Record<
      string,
      unknown
    >,
  saveIdPrefix: string,
  timestamp: number,
): {
  readonly metadata:
    SaveGameMetadata;

  readonly serialized:
    string;
} {
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

  const payload =
    serializePayload(
      data,
    );

  const metadata:
    SaveGameMetadata = {
      saveId:
        `${saveIdPrefix}_${slotName}_${String(timestamp)}`,

      slotName,

      playTimeSeconds:
        readPlayTimeSeconds(
          data,
        ),

      timestamp,

      gameVersion:
        readGameVersion(
          data,
        ),

      checksum:
        calculateSaveChecksum(
          payload,
        ),
    };

  const container:
    StoredSaveContainerV1 = {
      formatVersion:
        CURRENT_FORMAT_VERSION,

      metadata,

      payload,
    };

  return {
    metadata,

    serialized:
      JSON.stringify(
        container,
      ),
  };
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

      readonly data?:
        unknown;
    };

  if (
    candidate.formatVersion ===
      CURRENT_FORMAT_VERSION
  ) {
    if (
      !isMetadata(
        candidate.metadata,
      ) ||
      typeof candidate.payload !==
        "string"
    ) {
      throw new StorageInfrastructureError(
        "corrupted",
        "load",
        `Save '${expectedSlotName}' possui envelope v1 inválido.`,
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
  };
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
    encodeURIComponent(
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
