import { invoke } from "@tauri-apps/api/core";

import type {
  ModManifestDescriptor,
} from "../../../contracts/modding/types";

const WORKSHOP_ITEM_ID_PATTERN =
  /^\d{1,20}$/u;

const MAX_LOCAL_PATH_LENGTH =
  4096;

const MAX_TITLE_LENGTH =
  128;

const MAX_DESCRIPTION_LENGTH =
  8 * 1024;

function isTauriRuntime(): boolean {
  return (
    "__TAURI_INTERNALS__" in
    globalThis
  );
}

function isSafeText(
  value:
    string,
  maxLength:
    number,
  allowEmpty =
    false,
): boolean {
  if (
    value.includes("\0") ||
    value.length >
      maxLength
  ) {
    return false;
  }

  return (
    allowEmpty ||
    value.trim().length >
      0
  );
}

export class TauriModdingDriver {
  public async scanLocalMods():
    Promise<
      ReadonlyArray<
        ModManifestDescriptor
      >
    > {
    if (
      !isTauriRuntime()
    ) {
      return [];
    }

    try {
      return await invoke<
        ReadonlyArray<
          ModManifestDescriptor
        >
      >(
        "modding_scan_local_mods",
      );
    } catch (
      error:
        unknown
    ) {
      throw this.wrapInvokeError(
        "scanLocalMods",
        error,
      );
    }
  }

  public async downloadWorkshopItem(
    itemId:
      string,
  ): Promise<boolean> {
    const normalizedItemId =
      itemId.trim();

    if (
      !WORKSHOP_ITEM_ID_PATTERN
        .test(
          normalizedItemId,
        ) ||
      !isTauriRuntime()
    ) {
      return false;
    }

    try {
      return await invoke<boolean>(
        "steam_workshop_download_item",
        {
          publishedFileId:
            normalizedItemId,

          highPriority:
            false,
        },
      );
    } catch (
      error:
        unknown
    ) {
      console.error(
        "[TauriModdingDriver] Falha no download da Oficina da Steam:",
        error,
      );

      return false;
    }
  }

  public async publishWorkshopItem(
    localFolderPath:
      string,
    title:
      string,
    description:
      string,
  ): Promise<string> {
    const normalizedPath =
      localFolderPath.trim();

    const normalizedTitle =
      title.trim();

    if (
      !isSafeText(
        normalizedPath,
        MAX_LOCAL_PATH_LENGTH,
      )
    ) {
      throw new RangeError(
        "Pasta local do mod é inválida.",
      );
    }

    if (
      !isSafeText(
        normalizedTitle,
        MAX_TITLE_LENGTH,
      )
    ) {
      throw new RangeError(
        "Título do mod é inválido.",
      );
    }

    if (
      !isSafeText(
        description,
        MAX_DESCRIPTION_LENGTH,
        true,
      )
    ) {
      throw new RangeError(
        "Descrição do mod é inválida.",
      );
    }

    if (
      !isTauriRuntime()
    ) {
      throw new Error(
        "Publicação Workshop exige runtime Tauri.",
      );
    }

    try {
      return await invoke<string>(
        "modding_publish_workshop_item",
        {
          localFolderPath:
            normalizedPath,

          title:
            normalizedTitle,

          description,
        },
      );
    } catch (
      error:
        unknown
    ) {
      throw this.wrapInvokeError(
        "publishWorkshopItem",
        error,
      );
    }
  }

  private wrapInvokeError(
    operation:
      string,
    error:
      unknown,
  ): Error {
    const message =
      error instanceof Error
        ? error.message
        : String(
            error,
          );

    return new Error(
      `[TauriModdingDriver.${operation}] ${message}`,
    );
  }
}
