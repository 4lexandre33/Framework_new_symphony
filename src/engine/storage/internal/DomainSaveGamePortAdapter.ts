import type {
  StorageDriverType,
} from "../../../contracts/storage/types";

import type {
  DomainResult,
} from "../../../domain/evaluation/DomainResult";

import type {
  DomainSaveGamePort,
  DomainSaveGameRecord,
  DomainSaveState,
} from "../../../domain/ports/DomainSaveGamePort";

import type {
  SaveGamePortError,
  SaveGameSummary,
  SaveSlotId,
} from "../../../domain/ports/SaveGamePort";

import type {
  VersionedSnapshot,
} from "../../../domain/entities/VersionedSnapshot";

import type {
  StorageApi,
} from "../../../tokens/storage";

import {
  StorageInfrastructureError,
} from "./StorageErrors";

type SaveDriver =
  Exclude<
    StorageDriverType,
    "cloud_database"
  >;

interface PersistedDomainSaveEnvelope {
  readonly format:
    "projeto1.domain-save.v1";

  readonly slotId:
    string;

  readonly createdAtEpochMs:
    number;

  readonly label:
    string | null;

  readonly snapshot:
    VersionedSnapshot<
      DomainSaveState
    >;
}

interface PersistedDomainSavePayload {
  readonly domainSave:
    PersistedDomainSaveEnvelope;
}

function ok<
  TValue,
>(
  value: TValue,
): DomainResult<
  TValue,
  SaveGamePortError
> {
  return {
    ok: true,
    value,
  };
}

function fail<
  TValue,
>(
  error:
    SaveGamePortError,
): DomainResult<
  TValue,
  SaveGamePortError
> {
  return {
    ok: false,
    error,
  };
}

function mapStorageError(
  error: unknown,
): SaveGamePortError {
  if (
    error instanceof
      StorageInfrastructureError
  ) {
    return {
      code:
        error.code,

      message:
        error.message,

      recoverable:
        error.recoverable,
    };
  }

  return {
    code:
      "operation-failed",

    message:
      error instanceof Error
        ? error.message
        : "Falha de persistência desconhecida.",

    recoverable:
      true,
  };
}

function isEnvelope(
  value: unknown,
): value is
  PersistedDomainSaveEnvelope {
  if (
    typeof value !==
      "object" ||
    value ===
      null
  ) {
    return false;
  }

  const candidate =
    value as Partial<
      PersistedDomainSaveEnvelope
    >;

  return (
    candidate.format ===
      "projeto1.domain-save.v1" &&
    typeof candidate.slotId ===
      "string" &&
    Number.isSafeInteger(
      candidate.createdAtEpochMs,
    ) &&
    (
      candidate.label ===
        null ||
      typeof candidate.label ===
        "string"
    ) &&
    typeof candidate.snapshot ===
      "object" &&
    candidate.snapshot !==
      null &&
    Number.isSafeInteger(
      candidate.snapshot
        .schemaVersion,
    ) &&
    candidate.snapshot
      .schemaVersion >
      0 &&
    Number.isSafeInteger(
      candidate.snapshot
        .createdAtEpochMs,
    ) &&
    candidate.snapshot
      .createdAtEpochMs >=
      0
  );
}

function unwrapEnvelope(
  value: unknown,
): PersistedDomainSaveEnvelope | null {
  if (
    typeof value !==
      "object" ||
    value ===
      null ||
    !(
      "domainSave" in
      value
    )
  ) {
    return null;
  }

  const envelope =
    (
      value as {
        readonly domainSave:
          unknown;
      }
    ).domainSave;

  return isEnvelope(
    envelope,
  )
    ? envelope
    : null;
}

function corrupted(
  slotId: string,
): SaveGamePortError {
  return {
    code:
      "corrupted",

    message:
      `Slot '${slotId}' possui envelope de domínio inválido.`,

    recoverable:
      false,
  };
}

/**
 * Adapter de infraestrutura para o port puro da Camada 2.
 *
 * Os imports de src/domain acima são type-only. O Domain não sabe que
 * StorageApi, Web Storage, Steam Cloud, Tauri ou qualquer backend concreto
 * existem.
 */
export class DomainSaveGamePortAdapter
  implements DomainSaveGamePort {
  public constructor(
    private readonly storage:
      StorageApi,

    private readonly driver:
      SaveDriver =
        "sqlite_local",
  ) {}

  public async listSlots():
    Promise<
      DomainResult<
        readonly SaveGameSummary[],
        SaveGamePortError
      >
    > {
    try {
      const metadata =
        await this.storage
          .listSaves(
            this.driver,
          );

      const summaries:
        SaveGameSummary[] =
          [];

      for (
        const item of
        metadata
      ) {
        const payload =
          await this.storage
            .loadGame<
              PersistedDomainSavePayload
            >(
              item.slotName,
              this.driver,
            );

        if (
          payload ===
            null
        ) {
          continue;
        }

        const envelope =
          unwrapEnvelope(
            payload,
          );

        if (
          envelope ===
            null
        ) {
          return fail(
            corrupted(
              item.slotName,
            ),
          );
        }

        summaries.push({
          slotId:
            envelope.slotId as
              SaveSlotId,

          schemaVersion:
            envelope.snapshot
              .schemaVersion,

          createdAtEpochMs:
            envelope
              .createdAtEpochMs,

          updatedAtEpochMs:
            item.timestamp,

          label:
            envelope.label,
        });
      }

      summaries.sort(
        (
          left,
          right,
        ): number => {
          const byTime =
            right.updatedAtEpochMs -
            left.updatedAtEpochMs;

          if (
            byTime !==
              0
          ) {
            return byTime;
          }

          return String(
            left.slotId,
          ).localeCompare(
            String(
              right.slotId,
            ),
          );
        },
      );

      return ok(
        summaries,
      );
    } catch (
      error
    ) {
      return fail(
        mapStorageError(
          error,
        ),
      );
    }
  }

  public async load(
    slotId: SaveSlotId,
  ): Promise<
    DomainResult<
      DomainSaveGameRecord | null,
      SaveGamePortError
    >
  > {
    try {
      const slotName =
        String(
          slotId,
        );

      const payload =
        await this.storage
          .loadGame<
            PersistedDomainSavePayload
          >(
            slotName,
            this.driver,
          );

      if (
        payload ===
          null
      ) {
        return ok(
          null,
        );
      }

      const envelope =
        unwrapEnvelope(
          payload,
        );

      if (
        envelope ===
          null ||
        envelope.slotId !==
          slotName
      ) {
        return fail(
          corrupted(
            slotName,
          ),
        );
      }

      const metadata =
        (
          await this.storage
            .listSaves(
              this.driver,
            )
        ).find(
          (
            item,
          ): boolean =>
            item.slotName ===
            slotName,
        );

      if (
        metadata ===
          undefined
      ) {
        return fail({
          code:
            "operation-failed",

          message:
            `Metadata do slot '${slotName}' não pôde ser localizada.`,

          recoverable:
            true,
        });
      }

      return ok({
        slotId,

        snapshot:
          envelope.snapshot,

        updatedAtEpochMs:
          metadata.timestamp,

        label:
          envelope.label,
      });
    } catch (
      error
    ) {
      return fail(
        mapStorageError(
          error,
        ),
      );
    }
  }

  public async save(
    slotId: SaveSlotId,
    snapshot:
      VersionedSnapshot<
        DomainSaveState
      >,
    label: string | null =
      null,
  ): Promise<
    DomainResult<
      DomainSaveGameRecord,
      SaveGamePortError
    >
  > {
    const slotName =
      String(
        slotId,
      );

    try {
      const previousPayload =
        await this.storage
          .loadGame<
            PersistedDomainSavePayload
          >(
            slotName,
            this.driver,
          );

      const previousEnvelope =
        previousPayload ===
          null
          ? null
          : unwrapEnvelope(
              previousPayload,
            );

      if (
        previousPayload !==
          null &&
        previousEnvelope ===
          null
      ) {
        return fail(
          corrupted(
            slotName,
          ),
        );
      }

      const envelope:
        PersistedDomainSaveEnvelope = {
          format:
            "projeto1.domain-save.v1",

          slotId:
            slotName,

          createdAtEpochMs:
            previousEnvelope
              ?.createdAtEpochMs ??
            snapshot
              .createdAtEpochMs,

          label,

          snapshot,
        };

      const metadata =
        await this.storage
          .saveGame(
            slotName,
            {
              domainSave:
                envelope,
            },
            this.driver,
          );

      return ok({
        slotId,

        snapshot,

        updatedAtEpochMs:
          metadata.timestamp,

        label,
      });
    } catch (
      error
    ) {
      return fail(
        mapStorageError(
          error,
        ),
      );
    }
  }

  public async delete(
    slotId: SaveSlotId,
  ): Promise<
    DomainResult<
      boolean,
      SaveGamePortError
    >
  > {
    try {
      return ok(
        await this.storage
          .deleteSave(
            String(
              slotId,
            ),
            this.driver,
          ),
      );
    } catch (
      error
    ) {
      return fail(
        mapStorageError(
          error,
        ),
      );
    }
  }
}
