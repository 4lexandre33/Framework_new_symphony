import {
  createVersionedSnapshot,
} from "../../domain/entities/VersionedSnapshot";

import {
  domainErr,
  domainOk,
} from "../../domain/evaluation/DomainResult";

import type {
  DomainResult,
} from "../../domain/evaluation/DomainResult";

import type {
  ClockPort,
} from "../../domain/ports/ClockPort";

import type {
  SaveGamePort,
  SaveGamePortError,
  SaveGameRecord,
  SaveGameSummary,
  SaveSlotId,
} from "../../domain/ports/SaveGamePort";

export type SaveLoadOperation =
  | "list"
  | "load"
  | "save"
  | "delete";

export interface SaveLoadPortFailure {
  readonly code: "port-error";
  readonly operation:
    SaveLoadOperation;
  readonly cause:
    SaveGamePortError;
}

export interface SaveLoadSlotNotFound {
  readonly code:
    "slot-not-found";
  readonly slotId:
    SaveSlotId;
}

export interface SaveLoadUnsupportedSchema {
  readonly code:
    "unsupported-schema";
  readonly slotId:
    SaveSlotId;
  readonly expectedSchemaVersion:
    number;
  readonly actualSchemaVersion:
    number;
}

export interface SaveLoadInvalidPortResponse {
  readonly code:
    "invalid-port-response";
  readonly operation:
    "load" | "save";
  readonly expectedSlotId:
    SaveSlotId;
  readonly actualSlotId:
    SaveSlotId;
}

export type SaveLoadUseCaseError =
  | SaveLoadPortFailure
  | SaveLoadSlotNotFound
  | SaveLoadUnsupportedSchema
  | SaveLoadInvalidPortResponse;

export interface SaveLoadUseCaseDependencies<
  TState,
> {
  readonly saveGamePort:
    SaveGamePort<TState>;
  readonly clock:
    ClockPort;
  readonly schemaVersion:
    number;
}

export class SaveLoadUseCaseConfigurationError
  extends Error {
  public readonly name =
    "SaveLoadUseCaseConfigurationError";

  public constructor(
    message: string,
  ) {
    super(message);
  }
}

function assertSchemaVersion(
  schemaVersion: number,
): void {
  if (
    !Number.isSafeInteger(
      schemaVersion,
    ) ||
    schemaVersion < 1
  ) {
    throw new SaveLoadUseCaseConfigurationError(
      "schemaVersion deve ser um inteiro seguro maior ou igual a 1.",
    );
  }
}

function portFailure(
  operation:
    SaveLoadOperation,
  cause:
    SaveGamePortError,
): SaveLoadPortFailure {
  return {
    code: "port-error",
    operation,
    cause,
  };
}

/**
 * Caso de uso de save/load da Camada 3.
 *
 * Responsabilidades:
 * - orquestrar ClockPort + SaveGamePort;
 * - criar snapshots versionados;
 * - validar schema no load;
 * - traduzir falhas do port em erros da aplicação;
 * - rejeitar respostas de port que retornem outro slot.
 *
 * Não serializa JSON, não acessa filesystem, IndexedDB, Steam Cloud, Tauri,
 * engine, plugins ou drivers concretos. O mesmo caso de uso atende jogos 2D,
 * 2.5D e 3D porque TState permanece genérico.
 */
export class SaveLoadUseCase<
  TState,
> {
  private readonly saveGamePort:
    SaveGamePort<TState>;

  private readonly clock:
    ClockPort;

  private readonly schemaVersionValue:
    number;

  public constructor(
    dependencies:
      SaveLoadUseCaseDependencies<TState>,
  ) {
    assertSchemaVersion(
      dependencies.schemaVersion,
    );

    this.saveGamePort =
      dependencies.saveGamePort;

    this.clock =
      dependencies.clock;

    this.schemaVersionValue =
      dependencies.schemaVersion;
  }

  public get schemaVersion():
    number {
    return this.schemaVersionValue;
  }

  public async listSlots():
    Promise<
      DomainResult<
        readonly SaveGameSummary[],
        SaveLoadUseCaseError
      >
    > {
    const result =
      await this.saveGamePort
        .listSlots();

    if (!result.ok) {
      return domainErr(
        portFailure(
          "list",
          result.error,
        ),
      );
    }

    return domainOk(
      result.value,
    );
  }

  public async save(
    slotId: SaveSlotId,
    state: TState,
    label: string | null =
      null,
  ): Promise<
    DomainResult<
      SaveGameRecord<TState>,
      SaveLoadUseCaseError
    >
  > {
    const snapshot =
      createVersionedSnapshot(
        this.schemaVersionValue,
        this.clock.nowEpochMs(),
        state,
      );

    const result =
      await this.saveGamePort
        .save(
          slotId,
          snapshot,
          label,
        );

    if (!result.ok) {
      return domainErr(
        portFailure(
          "save",
          result.error,
        ),
      );
    }

    if (
      result.value.slotId !==
      slotId
    ) {
      return domainErr({
        code:
          "invalid-port-response",
        operation: "save",
        expectedSlotId:
          slotId,
        actualSlotId:
          result.value.slotId,
      });
    }

    return domainOk(
      result.value,
    );
  }

  public async load(
    slotId: SaveSlotId,
  ): Promise<
    DomainResult<
      SaveGameRecord<TState>,
      SaveLoadUseCaseError
    >
  > {
    const result =
      await this.saveGamePort
        .load(slotId);

    if (!result.ok) {
      return domainErr(
        portFailure(
          "load",
          result.error,
        ),
      );
    }

    const record =
      result.value;

    if (record === null) {
      return domainErr({
        code:
          "slot-not-found",
        slotId,
      });
    }

    if (
      record.slotId !== slotId
    ) {
      return domainErr({
        code:
          "invalid-port-response",
        operation: "load",
        expectedSlotId:
          slotId,
        actualSlotId:
          record.slotId,
      });
    }

    const actualSchemaVersion =
      record.snapshot
        .schemaVersion;

    if (
      actualSchemaVersion !==
      this.schemaVersionValue
    ) {
      return domainErr({
        code:
          "unsupported-schema",
        slotId,
        expectedSchemaVersion:
          this.schemaVersionValue,
        actualSchemaVersion,
      });
    }

    return domainOk(record);
  }

  public async delete(
    slotId: SaveSlotId,
  ): Promise<
    DomainResult<
      true,
      SaveLoadUseCaseError
    >
  > {
    const result =
      await this.saveGamePort
        .delete(slotId);

    if (!result.ok) {
      return domainErr(
        portFailure(
          "delete",
          result.error,
        ),
      );
    }

    if (!result.value) {
      return domainErr({
        code:
          "slot-not-found",
        slotId,
      });
    }

    return domainOk(true);
  }
}
