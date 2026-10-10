import type {
  LoadGameResult,
  SaveGameMetadata,
  SaveGameOptions,
  SaveMigration,
} from "../../../contracts/storage/types";

import type {
  AnyKeyValueStorageBackend,
} from "./KeyValueStorageBackend";

import {
  assertSlotName,
  computeHmac,
  decodeStoredSave,
  isInternalKey,
  isMetadata,
  makeBackupKey,
  makeIndexKey,
  makeLegacyStorageKey,
  makeStorageKey,
  peekStoredSlotName,
  prepareSave,
  serializePreparedSave,
  type DecodedSaveRecord,
} from "./SaveRecordCodec";

import {
  StorageInfrastructureError,
  normalizeStorageError,
  storageError,
} from "./StorageErrors";

export interface KeyValueSaveDriverOptions {
  readonly backend:
    AnyKeyValueStorageBackend;

  readonly storagePrefix:
    string;

  readonly saveIdPrefix:
    string;

  readonly now?:
    () => number;
}

/** Configuração compartilhada pelos drivers (definida pelo StorageService). */
export interface SaveDriverConfig {
  readonly namespace:
    string | null;

  readonly adoptLegacySaves:
    boolean;

  readonly backupCount:
    number;

  readonly integrityKey:
    string | null;

  readonly requireSignature:
    boolean;

  readonly schemaVersion:
    number | undefined;

  readonly gameVersion:
    string | undefined;

  readonly migrations:
    ReadonlyMap<number, SaveMigration>;
}

export const MAX_BACKUPS =
  5;

export const DEFAULT_SAVE_DRIVER_CONFIG:
  SaveDriverConfig = {
    namespace:
      null,
    adoptLegacySaves:
      false,
    backupCount:
      1,
    integrityKey:
      null,
    requireSignature:
      false,
    schemaVersion:
      undefined,
    gameVersion:
      undefined,
    migrations:
      new Map(),
  };

interface SaveIndex {
  readonly v: 1;
  readonly entries: Record<string, SaveGameMetadata>;
}

interface LoadedRecord<T> {
  readonly decoded: DecodedSaveRecord<T>;
  readonly data: T;
  readonly migratedFrom: number[];
}

/**
 * Implementação comum para stores key-value (síncronos ou assíncronos).
 *
 * - Chaves: `[ns:<namespace>:]<prefixo><slot codificado>`; chaves internas
 *   (`#index`, `#bakN:`) nunca colidem com slots (G102).
 * - Rodízio de backups por slot e recuperação automática (G101).
 * - Assinatura HMAC opcional; checksum FNV sempre (G101).
 * - `listSaves` usa um índice de metadados (G102).
 * - schemaVersion + migrações no load (G103).
 * - Operações no mesmo slot são serializadas.
 */
export class KeyValueSaveDriver {
  private readonly backend:
    AnyKeyValueStorageBackend;

  private readonly basePrefix:
    string;

  private readonly saveIdPrefix:
    string;

  private readonly now:
    () => number;

  private config:
    SaveDriverConfig =
      DEFAULT_SAVE_DRIVER_CONFIG;

  private readonly slotQueues =
    new Map<
      string,
      Promise<unknown>
    >();

  public constructor(
    options:
      KeyValueSaveDriverOptions,
  ) {
    this.backend =
      options.backend;

    this.basePrefix =
      options.storagePrefix;

    this.saveIdPrefix =
      options.saveIdPrefix;

    this.now =
      options.now ??
      Date.now;
  }

  public configure(
    config:
      SaveDriverConfig,
  ): void {
    this.config =
      config;
  }

  public getConfig():
    SaveDriverConfig {
    return this.config;
  }

  /** Prefixo efetivo (com namespace). */
  public get storagePrefix():
    string {
    const namespace =
      this.config.namespace;

    return namespace
      ? `ns:${encodeURIComponent(namespace)}:${this.basePrefix}`
      : this.basePrefix;
  }

  public async saveGame(
    slotName: string,
    data:
      Record<
        string,
        unknown
      >,
    options?:
      SaveGameOptions,
  ): Promise<
    SaveGameMetadata
  > {
    assertSlotName(
      slotName,
      "save",
    );

    return await this.runExclusive(
      slotName,
      async () => {
        try {
          return await this.saveUnlocked(
            slotName,
            data,
            options,
          );
        } catch (
          error
        ) {
          throw normalizeStorageError(
            error,
            "save",
            `Falha ao persistir o slot '${slotName}'.`,
          );
        }
      },
    );
  }

  /**
   * Carrega os dados. Slot inexistente: null. Principal corrompido: tenta os
   * backups (recuperação silenciosa para o chamador; veja `loadGameDetailed`
   * para saber o que aconteceu). Tudo corrompido: rejeita `corrupted`.
   */
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
    const result =
      await this.loadGameDetailed<T>(
        slotName,
      );

    if (
      result.status ===
        "corrupted"
    ) {
      throw storageError(
        "corrupted",
        "load",
        result.error ??
          `Save '${slotName}' corrompido e sem backup válido.`,
        false,
        "corrupted",
      );
    }

    return result.data;
  }

  /**
   * Nunca rejeita por corrupção: devolve status "ok" | "recovered" |
   * "missing" | "corrupted". Rejeita por erro de infraestrutura (backend
   * indisponível) ou de schema (versão futura / migração ausente).
   */
  public async loadGameDetailed<
    T =
      Record<
        string,
        unknown
      >,
  >(
    slotName: string,
  ): Promise<
    LoadGameResult<T>
  > {
    assertSlotName(
      slotName,
      "load",
    );

    return await this.runExclusive(
      slotName,
      async () => {
        try {
          return await this.loadUnlocked<T>(
            slotName,
          );
        } catch (
          error
        ) {
          throw normalizeStorageError(
            error,
            "load",
            `Falha ao carregar o slot '${slotName}'.`,
          );
        }
      },
    );
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

      await this.collectSaves(
        this.storagePrefix,
        bySlot,
        true,
      );

      if (
        this.config.namespace &&
        this.config.adoptLegacySaves
      ) {
        const legacy =
          new Map<
            string,
            SaveGameMetadata
          >();

        await this.collectSaves(
          this.basePrefix,
          legacy,
          false,
        );

        for (
          const [
            slot,
            metadata,
          ] of
          legacy
        ) {
          if (
            !bySlot.has(
              slot,
            )
          ) {
            bySlot.set(
              slot,
              metadata,
            );
          }
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
    assertSlotName(
      slotName,
      "delete",
    );

    return await this.runExclusive(
      slotName,
      async () => {
        try {
          const prefix =
            this.storagePrefix;

          const key =
            makeStorageKey(
              prefix,
              slotName,
            );

          let removed =
            false;

          if (
            (await this.backend.getItem(
              key,
            )) !==
              null
          ) {
            await this.backend.removeItem(
              key,
            );

            removed =
              true;
          }

          if (
            await this.removeLegacyIfOwned(
              prefix,
              slotName,
              key,
            )
          ) {
            removed =
              true;
          }

          for (
            let index =
              1;
            index <=
            MAX_BACKUPS;
            index +=
              1
          ) {
            const backupKey =
              makeBackupKey(
                prefix,
                slotName,
                index,
              );

            if (
              (await this.backend.getItem(
                backupKey,
              )) !==
                null
            ) {
              await this.backend.removeItem(
                backupKey,
              );
            }
          }

          await this.updateIndex(
            prefix,
            key,
            null,
          );

          return removed;
        } catch (
          error
        ) {
          throw normalizeStorageError(
            error,
            "delete",
            `Falha ao remover o slot '${slotName}'.`,
          );
        }
      },
    );
  }

  /* ─────────────────────────────── internos ─────────────────────────── */

  private async saveUnlocked(
    slotName: string,
    data:
      Record<
        string,
        unknown
      >,
    options?:
      SaveGameOptions,
  ): Promise<SaveGameMetadata> {
    const config =
      this.config;

    const prepared =
      prepareSave(
        slotName,
        data,
        this.saveIdPrefix,
        this.now(),
        options,
        {
          gameVersion:
            config.gameVersion,
          schemaVersion:
            config.schemaVersion,
        },
      );

    const signature =
      config.integrityKey
        ? await computeHmac(
            config.integrityKey,
            prepared.signingInput,
          )
        : undefined;

    const record =
      serializePreparedSave(
        prepared,
        signature,
      );

    const prefix =
      this.storagePrefix;

    const key =
      makeStorageKey(
        prefix,
        slotName,
      );

    const previous =
      await this.backend.getItem(
        key,
      );

    if (
      previous !==
        null &&
      config.backupCount >
        0
    ) {
      try {
        await this.rotateBackups(
          prefix,
          slotName,
          previous,
          config.backupCount,
        );
      } catch (
        error
      ) {
        if (
          !isQuotaError(
            error,
          )
        ) {
          throw error;
        }

        // Sem espaço para backups: libera os deste slot e segue.
        await this.removeBackups(
          prefix,
          slotName,
        );
      }
    }

    try {
      await this.backend.setItem(
        key,
        record.serialized,
      );
    } catch (
      error
    ) {
      if (
        !isQuotaError(
          error,
        )
      ) {
        throw error;
      }

      // Cota: libera os backups deste slot e tenta uma vez mais (G102).
      await this.removeBackups(
        prefix,
        slotName,
      );

      try {
        await this.backend.setItem(
          key,
          record.serialized,
        );
      } catch (
        retryError
      ) {
        const normalized =
          normalizeStorageError(
            retryError,
            "save",
            `Sem espaço para gravar o slot '${slotName}' (cota do armazenamento esgotada).`,
          );

        normalized.reason =
          "quota-exceeded";

        throw normalized;
      }
    }

    await this.removeLegacyIfOwned(
      prefix,
      slotName,
      key,
    );

    await this.updateIndex(
      prefix,
      key,
      record.metadata,
    );

    return record.metadata;
  }

  private async loadUnlocked<T>(
    slotName: string,
  ): Promise<LoadGameResult<T>> {
    const prefix =
      this.storagePrefix;

    const key =
      makeStorageKey(
        prefix,
        slotName,
      );

    let raw =
      await this.backend.getItem(
        key,
      );

    if (
      raw ===
        null
    ) {
      raw =
        await this.readLegacy(
          prefix,
          slotName,
          key,
        );
    }

    if (
      raw ===
        null &&
      this.config.namespace &&
      this.config.adoptLegacySaves
    ) {
      const baseKey =
        makeStorageKey(
          this.basePrefix,
          slotName,
        );

      raw =
        (await this.backend.getItem(
          baseKey,
        )) ??
        (await this.readLegacy(
          this.basePrefix,
          slotName,
          baseKey,
        ));
    }

    if (
      raw ===
        null
    ) {
      // Principal ausente mas backup presente (ex.: gravação interrompida).
      const fromBackup =
        await this.tryBackups<T>(
          prefix,
          slotName,
        );

      if (
        fromBackup
      ) {
        return fromBackup.result;
      }

      return {
        status:
          "missing",
        data:
          null,
        metadata:
          null,
      };
    }

    try {
      const loaded =
        await this.decodeAndVerify<T>(
          raw,
          slotName,
        );

      return {
        status:
          "ok",
        data:
          loaded.data,
        metadata:
          loaded.decoded.metadata,
        ...(loaded.migratedFrom.length > 0
          ? { migratedFrom: loaded.migratedFrom }
          : {}),
      };
    } catch (
      error
    ) {
      if (
        !isCorruption(
          error,
        )
      ) {
        throw error;
      }

      const reason =
        error instanceof Error
          ? error.message
          : String(error);

      const fromBackup =
        await this.tryBackups<T>(
          prefix,
          slotName,
          reason,
        );

      if (
        fromBackup
      ) {
        // Restaura o principal a partir do backup válido (melhor esforço).
        try {
          await this.backend.setItem(
            key,
            fromBackup.raw,
          );

          if (
            fromBackup.result.metadata
          ) {
            await this.updateIndex(
              prefix,
              key,
              fromBackup.result.metadata,
            );
          }
        } catch {
          // mantém o backup; o próximo save regrava o principal
        }

        return fromBackup.result;
      }

      return {
        status:
          "corrupted",
        data:
          null,
        metadata:
          null,
        error:
          reason,
      };
    }
  }

  private async tryBackups<T>(
    prefix: string,
    slotName: string,
    reason?: string,
  ): Promise<{ result: LoadGameResult<T>; raw: string } | null> {
    for (
      let index =
        1;
      index <=
      MAX_BACKUPS;
      index +=
        1
    ) {
      const raw =
        await this.backend.getItem(
          makeBackupKey(
            prefix,
            slotName,
            index,
          ),
        );

      if (
        raw ===
          null
      ) {
        continue;
      }

      try {
        const loaded =
          await this.decodeAndVerify<T>(
            raw,
            slotName,
          );

        return {
          raw,
          result: {
            status:
              "recovered",
            data:
              loaded.data,
            metadata:
              loaded.decoded.metadata,
            backupIndex:
              index,
            ...(loaded.migratedFrom.length > 0
              ? { migratedFrom: loaded.migratedFrom }
              : {}),
            ...(reason !== undefined
              ? { error: reason }
              : {}),
          },
        };
      } catch (
        error
      ) {
        if (
          !isCorruption(
            error,
          )
        ) {
          throw error;
        }
      }
    }

    return null;
  }

  private async decodeAndVerify<T>(
    raw: string,
    slotName: string,
  ): Promise<LoadedRecord<T>> {
    const decoded =
      decodeStoredSave<T>(
        raw,
        slotName,
      );

    const config =
      this.config;

    if (
      decoded.signature !==
        undefined &&
      config.integrityKey
    ) {
      const expected =
        await computeHmac(
          config.integrityKey,
          decoded.signingInput,
        );

      if (
        expected !==
          decoded.signature
      ) {
        throw storageError(
          "corrupted",
          "load",
          `Assinatura do save '${slotName}' não confere (adulterado ou chave diferente).`,
          false,
          "signature-mismatch",
        );
      }
    } else if (
      decoded.signature ===
        undefined &&
      config.integrityKey &&
      config.requireSignature
    ) {
      throw storageError(
        "corrupted",
        "load",
        `Save '${slotName}' não tem assinatura e a configuração exige uma.`,
        false,
        "unsigned",
      );
    }

    const migrated =
      this.migrate(
        decoded.data,
        decoded.metadata.schemaVersion,
        slotName,
      );

    return {
      decoded,
      data:
        migrated.data as T,
      migratedFrom:
        migrated.steps,
    };
  }

  /**
   * Roda as migrações de `recordVersion` até a versão atual. Registro sem
   * versão = versão atual, salvo se houver migração registrada a partir de 0.
   */
  private migrate(
    data: unknown,
    recordVersion: number | undefined,
    slotName: string,
  ): { data: unknown; steps: number[] } {
    const target =
      this.config.schemaVersion;

    const steps: number[] = [];

    if (
      target ===
        undefined
    ) {
      return { data, steps };
    }

    let version =
      recordVersion ??
      (this.config.migrations.has(
        0,
      )
        ? 0
        : target);

    if (
      version >
        target
    ) {
      throw storageError(
        "operation-failed",
        "load",
        `Save '${slotName}' é do schema ${String(version)}, mais novo que o suportado (${String(target)}).`,
        false,
        "unsupported-schema",
      );
    }

    let current =
      data;

    while (
      version <
        target
    ) {
      const migration =
        this.config.migrations.get(
          version,
        );

      if (!migration) {
        throw storageError(
          "operation-failed",
          "load",
          `Sem migração registrada do schema ${String(version)} para ${String(version + 1)} (slot '${slotName}').`,
          false,
          "migration-failed",
        );
      }

      try {
        current =
          migration(
            current as Record<string, unknown>,
          );
      } catch (
        error
      ) {
        throw storageError(
          "operation-failed",
          "load",
          `Migração ${String(version)}→${String(version + 1)} falhou no slot '${slotName}'.`,
          false,
          "migration-failed",
          error,
        );
      }

      steps.push(
        version,
      );

      version +=
        1;
    }

    return { data: current, steps };
  }

  private async rotateBackups(
    prefix: string,
    slotName: string,
    previous: string,
    count: number,
  ): Promise<void> {
    const safeCount =
      Math.min(
        MAX_BACKUPS,
        Math.max(
          0,
          Math.floor(
            count,
          ),
        ),
      );

    for (
      let index =
        safeCount;
      index >
      1;
      index -=
        1
    ) {
      const older =
        await this.backend.getItem(
          makeBackupKey(
            prefix,
            slotName,
            index - 1,
          ),
        );

      if (
        older !==
          null
      ) {
        await this.backend.setItem(
          makeBackupKey(
            prefix,
            slotName,
            index,
          ),
          older,
        );
      }
    }

    // Só guarda como backup um registro que ainda é válido.
    if (
      this.isDecodable(
        previous,
        slotName,
      )
    ) {
      await this.backend.setItem(
        makeBackupKey(
          prefix,
          slotName,
          1,
        ),
        previous,
      );
    }

    for (
      let index =
        safeCount + 1;
      index <=
      MAX_BACKUPS;
      index +=
        1
    ) {
      const extraKey =
        makeBackupKey(
          prefix,
          slotName,
          index,
        );

      if (
        (await this.backend.getItem(
          extraKey,
        )) !==
          null
      ) {
        await this.backend.removeItem(
          extraKey,
        );
      }
    }
  }

  private isDecodable(
    raw: string,
    slotName: string,
  ): boolean {
    try {
      decodeStoredSave(
        raw,
        slotName,
      );

      return true;
    } catch {
      return false;
    }
  }

  private async removeBackups(
    prefix: string,
    slotName: string,
  ): Promise<void> {
    for (
      let index =
        1;
      index <=
      MAX_BACKUPS;
      index +=
        1
    ) {
      try {
        await this.backend.removeItem(
          makeBackupKey(
            prefix,
            slotName,
            index,
          ),
        );
      } catch {
        // ignora: liberação de espaço é melhor esforço
      }
    }
  }

  /**
   * Chave legada (nome cru): só vale se o registro for MESMO deste slot —
   * evita que "a%20b" leia/apague o save de "a b" (G102).
   */
  private async readLegacy(
    prefix: string,
    slotName: string,
    currentKey: string,
  ): Promise<string | null> {
    const legacyKey =
      makeLegacyStorageKey(
        prefix,
        slotName,
      );

    if (
      legacyKey ===
        currentKey
    ) {
      return null;
    }

    const raw =
      await this.backend.getItem(
        legacyKey,
      );

    if (
      raw ===
        null ||
      peekStoredSlotName(
        raw,
      ) !==
        slotName
    ) {
      return null;
    }

    return raw;
  }

  private async removeLegacyIfOwned(
    prefix: string,
    slotName: string,
    currentKey: string,
  ): Promise<boolean> {
    const raw =
      await this.readLegacy(
        prefix,
        slotName,
        currentKey,
      );

    if (
      raw ===
        null
    ) {
      return false;
    }

    await this.backend.removeItem(
      makeLegacyStorageKey(
        prefix,
        slotName,
      ),
    );

    return true;
  }

  private async listKeys():
    Promise<string[]> {
    const backend =
      this.backend as {
        keys?: () => Promise<string[]>;
        length?: number;
        key?: (index: number) => string | null;
      };

    if (
      typeof backend.keys ===
        "function"
    ) {
      return await backend.keys();
    }

    const keys: string[] = [];
    const length =
      backend.length ??
      0;

    for (
      let index =
        0;
      index <
      length;
      index +=
        1
    ) {
      const key =
        backend.key?.(
          index,
        ) ??
        null;

      if (
        key !==
          null
      ) {
        keys.push(
          key,
        );
      }
    }

    return keys;
  }

  private async readIndex(
    prefix: string,
  ): Promise<Map<string, SaveGameMetadata>> {
    const entries =
      new Map<
        string,
        SaveGameMetadata
      >();

    const raw =
      await this.backend.getItem(
        makeIndexKey(
          prefix,
        ),
      );

    if (
      raw ===
        null
    ) {
      return entries;
    }

    try {
      const parsed =
        JSON.parse(
          raw,
        ) as Partial<SaveIndex> | null;

      if (
        parsed?.v ===
          1 &&
        parsed.entries &&
        typeof parsed.entries ===
          "object"
      ) {
        for (
          const [
            key,
            metadata,
          ] of
          Object.entries(
            parsed.entries,
          )
        ) {
          if (
            isMetadata(
              metadata,
            )
          ) {
            entries.set(
              key,
              metadata,
            );
          }
        }
      }
    } catch {
      // índice corrompido: reconstruído pela varredura
    }

    return entries;
  }

  private async writeIndex(
    prefix: string,
    entries: Map<string, SaveGameMetadata>,
  ): Promise<void> {
    const index: SaveIndex = {
      v: 1,
      entries:
        Object.fromEntries(
          entries,
        ),
    };

    try {
      await this.backend.setItem(
        makeIndexKey(
          prefix,
        ),
        JSON.stringify(
          index,
        ),
      );
    } catch {
      // O índice é otimização: sem espaço, remove para forçar varredura.
      try {
        await this.backend.removeItem(
          makeIndexKey(
            prefix,
          ),
        );
      } catch {
        // ignora
      }
    }
  }

  private async updateIndex(
    prefix: string,
    key: string,
    metadata: SaveGameMetadata | null,
  ): Promise<void> {
    const entries =
      await this.readIndex(
        prefix,
      );

    if (
      metadata ===
        null
    ) {
      if (
        !entries.delete(
          key,
        )
      ) {
        return;
      }
    } else {
      entries.set(
        key,
        metadata,
      );
    }

    await this.writeIndex(
      prefix,
      entries,
    );
  }

  /**
   * Lista via índice: só lê (e decodifica) registros que não estão no
   * índice (saves antigos ou gravados por outra versão), e poda entradas
   * cujas chaves sumiram.
   */
  private async collectSaves(
    prefix: string,
    bySlot: Map<string, SaveGameMetadata>,
    maintainIndex: boolean,
  ): Promise<void> {
    const index =
      await this.readIndex(
        prefix,
      );

    const keys =
      await this.listKeys();

    const seen =
      new Set<string>();

    let changed =
      false;

    for (const key of keys) {
      if (
        !key.startsWith(
          prefix,
        ) ||
        isInternalKey(
          prefix,
          key,
        )
      ) {
        continue;
      }

      seen.add(
        key,
      );

      let metadata =
        index.get(
          key,
        );

      if (
        metadata ===
          undefined
      ) {
        const raw =
          await this.backend.getItem(
            key,
          );

        if (
          raw ===
            null
        ) {
          continue;
        }

        const rawSlotFromKey =
          key.slice(
            prefix.length,
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

        try {
          metadata =
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
          // A chave pode ser legada (nome cru) de um slot com '%'.
          const storedSlot =
            peekStoredSlotName(
              raw,
            );

          if (
            storedSlot ===
              null ||
            storedSlot ===
              slotFromKey
          ) {
            continue;
          }

          try {
            metadata =
              decodeStoredSave<
                Record<
                  string,
                  unknown
                >
              >(
                raw,
                storedSlot,
              ).metadata;
          } catch {
            // Um registro corrompido não pode impedir a enumeração dos demais.
            continue;
          }
        }

        index.set(
          key,
          metadata,
        );

        changed =
          true;
      }

      const previous =
        bySlot.get(
          metadata.slotName,
        );

      if (
        previous ===
          undefined ||
        metadata.timestamp >
          previous.timestamp
      ) {
        bySlot.set(
          metadata.slotName,
          metadata,
        );
      }
    }

    for (
      const key of
      Array.from(
        index.keys(),
      )
    ) {
      if (
        !seen.has(
          key,
        )
      ) {
        index.delete(
          key,
        );

        changed =
          true;
      }
    }

    if (
      changed &&
      maintainIndex
    ) {
      await this.writeIndex(
        prefix,
        index,
      );
    }
  }

  private async runExclusive<R>(
    slotName: string,
    task: () => Promise<R>,
  ): Promise<R> {
    const previous =
      this.slotQueues.get(
        slotName,
      ) ??
      Promise.resolve();

    const run =
      previous.then(
        task,
        task,
      );

    const settled =
      run.then(
        () => undefined,
        () => undefined,
      );

    this.slotQueues.set(
      slotName,
      settled,
    );

    try {
      return await run;
    } finally {
      if (
        this.slotQueues.get(
          slotName,
        ) ===
          settled
      ) {
        this.slotQueues.delete(
          slotName,
        );
      }
    }
  }
}

function isQuotaError(
  error: unknown,
): boolean {
  if (
    error instanceof
      StorageInfrastructureError
  ) {
    return error.code ===
      "quota-exceeded";
  }

  return normalizeStorageError(
    error,
    "save",
    "",
  ).code ===
    "quota-exceeded";
}

function isCorruption(
  error: unknown,
): boolean {
  return error instanceof
      StorageInfrastructureError &&
    error.code ===
      "corrupted";
}
