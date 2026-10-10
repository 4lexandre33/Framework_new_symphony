import type {
  LoadGameResult,
  SaveGameMetadata,
  SaveGameOptions,
} from "../../../contracts/storage/types";

import {
  GlobalLocalStorageBackend,
} from "./KeyValueStorageBackend";

import type {
  AnyKeyValueStorageBackend,
} from "./KeyValueStorageBackend";

import {
  KeyValueSaveDriver,
  type SaveDriverConfig,
} from "./KeyValueSaveDriver";

export interface SteamCloudDriverOptions {
  readonly backend?:
    AnyKeyValueStorageBackend;

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

  public configure(
    config:
      SaveDriverConfig,
  ): void {
    this.driver.configure(
      config,
    );
  }

  public saveGame(
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
    return this.driver
      .saveGame(
        slotName,
        data,
        options,
      );
  }

  public loadGameDetailed<
    T =
      Record<
        string,
        unknown
      >,
  >(
    slotName: string,
  ): Promise<LoadGameResult<T>> {
    return this.driver
      .loadGameDetailed<T>(
        slotName,
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
