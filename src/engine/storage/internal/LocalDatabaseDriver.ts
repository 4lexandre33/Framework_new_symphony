import type {
  SaveGameMetadata,
} from "../../../contracts/storage/types";

import {
  GlobalLocalStorageBackend,
} from "./KeyValueStorageBackend";

import type {
  KeyValueStorageBackend,
} from "./KeyValueStorageBackend";

import {
  KeyValueSaveDriver,
} from "./KeyValueSaveDriver";

export interface LocalDatabaseDriverOptions {
  readonly backend?:
    KeyValueStorageBackend;

  readonly now?:
    () => number;
}

/**
 * Persistência local.
 *
 * O nome histórico "sqlite_local" do contrato público é preservado, mas esta
 * classe não finge ser SQLite: na Etapa 82 o backend padrão continua sendo
 * Web Storage por compatibilidade. A Etapa 85 pode injetar um backend Tauri/SQL
 * sem alterar esta API interna nem StorageApi.
 */
export class LocalDatabaseDriver {
  private readonly driver:
    KeyValueSaveDriver;

  public constructor(
    options:
      LocalDatabaseDriverOptions =
        {},
  ) {
    this.driver =
      new KeyValueSaveDriver({
        backend:
          options.backend ??
          new GlobalLocalStorageBackend(),

        storagePrefix:
          "local_db_save_",

        saveIdPrefix:
          "local_save",

        now:
          options.now,
      });
  }

  public saveGame(
    slotName: string,
    data:
      Record<
        string,
        unknown
      >,
  ): Promise<
    SaveGameMetadata
  > {
    return this.driver
      .saveGame(
        slotName,
        data,
      );
  }

  public loadGame<
    T =
      Record<
        string,
        unknown
      >,
  >(
    slotName: string,
  ): Promise<T | null> {
    return this.driver
      .loadGame<T>(
        slotName,
      );
  }

  public listSaves():
    Promise<
      SaveGameMetadata[]
    > {
    return this.driver
      .listSaves();
  }

  public deleteSave(
    slotName: string,
  ): Promise<boolean> {
    return this.driver
      .deleteSave(
        slotName,
      );
  }
}
