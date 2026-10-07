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

export interface SteamCloudDriverOptions {
  readonly backend?:
    KeyValueStorageBackend;

  readonly now?:
    () => number;
}

/**
 * Fachada de persistência para o canal Steam Cloud.
 *
 * Na Etapa 82 o backend padrão mantém o comportamento legado em Web Storage
 * para não antecipar Steamworks. O ponto importante é que o backend agora é
 * injetável: a Etapa 84 poderá fornecer Remote Storage real sem alterar o
 * contrato do driver nem a lógica de checksum/migração.
 */
export class SteamCloudDriver {
  private readonly driver:
    KeyValueSaveDriver;

  public constructor(
    options:
      SteamCloudDriverOptions =
        {},
  ) {
    this.driver =
      new KeyValueSaveDriver({
        backend:
          options.backend ??
          new GlobalLocalStorageBackend(),

        storagePrefix:
          "steam_cloud_save_",

        saveIdPrefix:
          "steam_save",

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
