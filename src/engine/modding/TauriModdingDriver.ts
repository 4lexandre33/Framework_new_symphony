import { invoke } from "@tauri-apps/api/core";
import type {
  ModManifestDescriptor,
} from "../../contracts/modding/types";

export class TauriModdingDriver {
  public async scanLocalMods(): Promise<ReadonlyArray<ModManifestDescriptor>> {
    try {
      return await invoke<ReadonlyArray<ModManifestDescriptor>>(
        "modding_scan_local_mods",
      );
    } catch (error: unknown) {
      if (this.isTauriRuntime()) {
        throw this.wrapInvokeError("scanLocalMods", error);
      }

      return [];
    }
  }

  public async downloadWorkshopItem(
    itemId: string,
  ): Promise<boolean> {
    const normalizedItemId = itemId.trim();
    if (!/^\d+$/.test(normalizedItemId)) return false;

    try {
      return await invoke<boolean>(
        "modding_download_workshop_item",
        { itemId: normalizedItemId },
      );
    } catch (error: unknown) {
      if (this.isTauriRuntime()) {
        console.error(
          "[TauriModdingDriver] Falha no download da Oficina da Steam:",
          error,
        );
      }

      return false;
    }
  }

  public async publishWorkshopItem(
    localFolderPath: string,
    title: string,
    description: string,
  ): Promise<string> {
    const normalizedPath = localFolderPath.trim();
    const normalizedTitle = title.trim();

    if (normalizedPath.length === 0) {
      throw new Error("Pasta local do mod é obrigatória.");
    }

    if (normalizedTitle.length === 0) {
      throw new Error("Título do mod é obrigatório.");
    }

    try {
      return await invoke<string>(
        "modding_publish_workshop_item",
        {
          localFolderPath: normalizedPath,
          title: normalizedTitle,
          description,
        },
      );
    } catch (error: unknown) {
      throw this.wrapInvokeError("publishWorkshopItem", error);
    }
  }

  private isTauriRuntime(): boolean {
    return "__TAURI_INTERNALS__" in globalThis;
  }

  private wrapInvokeError(
    operation: string,
    error: unknown,
  ): Error {
    const message = error instanceof Error
      ? error.message
      : String(error);

    return new Error(
      `[TauriModdingDriver.${operation}] ${message}`,
    );
  }
}
