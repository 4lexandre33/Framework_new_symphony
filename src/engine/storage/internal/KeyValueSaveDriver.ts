import type {
  SaveGameMetadata,
} from "../../../contracts/storage/types";

import type {
  KeyValueStorageBackend,
} from "./KeyValueStorageBackend";

import {
  createStoredSave,
  decodeStoredSave,
  makeLegacyStorageKey,
  makeStorageKey,
} from "./SaveRecordCodec";

import {
  normalizeStorageError,
} from "./StorageErrors";

export interface KeyValueSaveDriverOptions {
  readonly backend:
    KeyValueStorageBackend;

  readonly storagePrefix:
    string;

  readonly saveIdPrefix:
    string;

  readonly now?:
    () => number;
}

/**
 * Implementação comum para stores key-value.
 *
 * O driver persiste um envelope v1 com payload textual + checksum e ainda lê
 * o envelope legado da engine. Isso permite migrar sem invalidar saves antigos.
 */
export class KeyValueSaveDriver {
  private readonly backend:
    KeyValueStorageBackend;

  private readonly storagePrefix:
    string;

  private readonly saveIdPrefix:
    string;

  private readonly now:
    () => number;

  public constructor(
    options:
      KeyValueSaveDriverOptions,
  ) {
    this.backend =
      options.backend;

    this.storagePrefix =
      options.storagePrefix;

    this.saveIdPrefix =
      options.saveIdPrefix;

    this.now =
      options.now ??
      Date.now;
  }

  public async saveGame(
    slotName: string,
    data:
      Record<
        string,
        unknown
      >,
  ): Promise<
    SaveGameMetadata
  > {
    try {
      const record =
        createStoredSave(
          slotName,
          data,
          this.saveIdPrefix,
          this.now(),
        );

      const key =
        makeStorageKey(
          this.storagePrefix,
          slotName,
        );

      this.backend.setItem(
        key,
        record.serialized,
      );

      const legacyKey =
        makeLegacyStorageKey(
          this.storagePrefix,
          slotName,
        );

      if (
        legacyKey !==
          key
      ) {
        this.backend.removeItem(
          legacyKey,
        );
      }

      return record.metadata;
    } catch (
      error
    ) {
      throw normalizeStorageError(
        error,
        "save",
        `Falha ao persistir o slot '${slotName}'.`,
      );
    }
  }

  public async loadGame<
    T =
      Record<
        string,
        unknown
      >,
  >(
    slotName: string,
  ): Promise<
    T | null
  > {
    try {
      const key =
        makeStorageKey(
          this.storagePrefix,
          slotName,
        );

      let raw =
        this.backend.getItem(
          key,
        );

      if (
        raw ===
          null
      ) {
        const legacyKey =
          makeLegacyStorageKey(
            this.storagePrefix,
            slotName,
          );

        if (
          legacyKey !==
            key
        ) {
          raw =
            this.backend.getItem(
              legacyKey,
            );
        }
      }

      if (
        raw ===
          null
      ) {
        return null;
      }

      return decodeStoredSave<T>(
        raw,
        slotName,
      ).data;
    } catch (
      error
    ) {
      throw normalizeStorageError(
        error,
        "load",
        `Falha ao carregar o slot '${slotName}'.`,
      );
    }
  }

  public async listSaves():
    Promise<
      SaveGameMetadata[]
    > {
    try {
      const bySlot =
        new Map<
          string,
          SaveGameMetadata
        >();

      const length =
        this.backend.length;

      for (
        let index =
          0;
        index <
        length;
        index +=
          1
      ) {
        const key =
          this.backend.key(
            index,
          );

        if (
          key ===
            null ||
          !key.startsWith(
            this.storagePrefix,
          )
        ) {
          continue;
        }

        const raw =
          this.backend.getItem(
            key,
          );

        if (
          raw ===
            null
        ) {
          continue;
        }

        let parsed:
          SaveGameMetadata;

        try {
          const rawSlotFromKey =
            key.slice(
              this.storagePrefix
                .length,
            );

          let slotFromKey =
            rawSlotFromKey;

          try {
            slotFromKey =
              decodeURIComponent(
                rawSlotFromKey,
              );
          } catch {
            // Compatibilidade com chaves legadas que continham '%' literal.
          }

          parsed =
            decodeStoredSave<
              Record<
                string,
                unknown
              >
            >(
              raw,
              slotFromKey,
            ).metadata;
        } catch {
          // Um registro corrompido não pode impedir a enumeração dos demais.
          continue;
        }

        const previous =
          bySlot.get(
            parsed.slotName,
          );

        if (
          previous ===
            undefined ||
          parsed.timestamp >
            previous.timestamp
        ) {
          bySlot.set(
            parsed.slotName,
            parsed,
          );
        }
      }

      return Array.from(
        bySlot.values(),
      ).sort(
        (
          left,
          right,
        ): number => {
          const byTimestamp =
            right.timestamp -
            left.timestamp;

          if (
            byTimestamp !==
              0
          ) {
            return byTimestamp;
          }

          return left.slotName
            .localeCompare(
              right.slotName,
            );
        },
      );
    } catch (
      error
    ) {
      throw normalizeStorageError(
        error,
        "list",
        "Falha ao listar saves persistidos.",
      );
    }
  }

  public async deleteSave(
    slotName: string,
  ): Promise<boolean> {
    try {
      const key =
        makeStorageKey(
          this.storagePrefix,
          slotName,
        );

      const legacyKey =
        makeLegacyStorageKey(
          this.storagePrefix,
          slotName,
        );

      const hasCurrent =
        this.backend.getItem(
          key,
        ) !==
        null;

      const hasLegacy =
        legacyKey !==
          key &&
        this.backend.getItem(
          legacyKey,
        ) !==
          null;

      if (
        !hasCurrent &&
        !hasLegacy
      ) {
        return false;
      }

      if (
        hasCurrent
      ) {
        this.backend.removeItem(
          key,
        );
      }

      if (
        hasLegacy
      ) {
        this.backend.removeItem(
          legacyKey,
        );
      }

      return true;
    } catch (
      error
    ) {
      throw normalizeStorageError(
        error,
        "delete",
        `Falha ao remover o slot '${slotName}'.`,
      );
    }
  }
}
