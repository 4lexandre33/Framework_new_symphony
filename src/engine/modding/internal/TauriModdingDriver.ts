import { convertFileSrc, invoke } from "@tauri-apps/api/core";

import type {
  ModManifestDescriptor,
  WorkshopItemState,
} from "../../../contracts/modding/types";

const WORKSHOP_ITEM_ID_PATTERN = /^\d{1,20}$/u;
const MAX_LOCAL_PATH_LENGTH = 4096;
const MAX_TITLE_LENGTH = 128;
const MAX_DESCRIPTION_LENGTH = 8 * 1024;

export function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in globalThis;
}

function isSafeText(value: string, maxLength: number, allowEmpty = false): boolean {
  if (typeof value !== "string" || value.includes("\0") || value.length > maxLength) {
    return false;
  }
  return allowEmpty || value.trim().length > 0;
}

/** Espelho de `InstalledModDto` (Rust). */
export interface NativeInstalledMod {
  readonly manifest: unknown;
  readonly rootPath: string;
  readonly folderName: string;
  readonly source: "local" | "workshop";
  readonly workshopItemId: string | null;
  readonly error: string | null;
}

export class TauriModdingDriver {
  public get available(): boolean {
    return isTauriRuntime();
  }

  public async scanLocalMods(): Promise<ReadonlyArray<ModManifestDescriptor>> {
    if (!isTauriRuntime()) {
      return [];
    }

    try {
      return await invoke<ReadonlyArray<ModManifestDescriptor>>("modding_scan_local_mods");
    } catch (error: unknown) {
      throw this.wrapInvokeError("scanLocalMods", error);
    }
  }

  /** Mods locais + Workshop (inclui inválidos com `error`). Sem Tauri: `[]`. */
  public async listInstalledMods(): Promise<ReadonlyArray<NativeInstalledMod>> {
    if (!isTauriRuntime()) {
      return [];
    }

    try {
      const result = await invoke<NativeInstalledMod[]>("modding_list_installed_mods");
      return Array.isArray(result) ? result : [];
    } catch (error: unknown) {
      throw this.wrapInvokeError("listInstalledMods", error);
    }
  }

  /** Bytes de um arquivo do mod (validação de caminho no Rust). */
  public async readModFile(modId: string, relativePath: string): Promise<Uint8Array | null> {
    if (!isTauriRuntime()) {
      return null;
    }

    try {
      const result = await invoke<ArrayBuffer | number[]>("modding_read_mod_file", { modId, relativePath });
      if (result instanceof ArrayBuffer) return new Uint8Array(result);
      if (Array.isArray(result)) return Uint8Array.from(result);
      return null;
    } catch {
      return null;
    }
  }

  /** URL do asset protocol (exige `assetProtocol` habilitado no tauri.conf). */
  public toAssetUrl(rootPath: string, relativePath: string): string {
    const separator = rootPath.includes("\\") && !rootPath.includes("/") ? "\\" : "/";
    const joined = `${rootPath.replace(/[\\/]+$/u, "")}${separator}${relativePath.split("/").join(separator)}`;
    try {
      return convertFileSrc(joined);
    } catch {
      return joined;
    }
  }

  public async loadEnabledMods(): Promise<ReadonlyArray<string> | null> {
    if (!isTauriRuntime()) return null;
    try {
      const ids = await invoke<string[]>("modding_load_enabled_mods");
      return Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [];
    } catch {
      return null;
    }
  }

  public async saveEnabledMods(modIds: ReadonlyArray<string>): Promise<boolean> {
    if (!isTauriRuntime()) return false;
    try {
      return (await invoke<boolean>("modding_save_enabled_mods", { modIds: [...modIds] })) === true;
    } catch {
      return false;
    }
  }

  /** Assina (se preciso) e inicia o download real do item do Workshop. */
  public async downloadWorkshopItem(itemId: string): Promise<boolean> {
    const normalizedItemId = itemId.trim();

    if (!WORKSHOP_ITEM_ID_PATTERN.test(normalizedItemId) || !isTauriRuntime()) {
      return false;
    }

    try {
      return (await invoke<boolean>("modding_download_workshop_item", { itemId: normalizedItemId })) === true;
    } catch (error: unknown) {
      console.error("[TauriModdingDriver] Falha no download da Oficina da Steam:", error);
      return false;
    }
  }

  public async getWorkshopItemState(itemId: string): Promise<WorkshopItemState | null> {
    const normalizedItemId = itemId.trim();
    if (!WORKSHOP_ITEM_ID_PATTERN.test(normalizedItemId) || !isTauriRuntime()) {
      return null;
    }

    try {
      const state = await invoke<WorkshopItemState>("modding_workshop_item_state", { itemId: normalizedItemId });
      return state && state.itemId === normalizedItemId ? state : null;
    } catch {
      return null;
    }
  }

  public async publishWorkshopItem(
    localFolderPath: string,
    title: string,
    description: string,
  ): Promise<string> {
    const normalizedPath = localFolderPath.trim();
    const normalizedTitle = title.trim();

    if (!isSafeText(normalizedPath, MAX_LOCAL_PATH_LENGTH)) {
      throw new RangeError("Pasta local do mod é inválida.");
    }

    if (!isSafeText(normalizedTitle, MAX_TITLE_LENGTH)) {
      throw new RangeError("Título do mod é inválido.");
    }

    if (!isSafeText(description, MAX_DESCRIPTION_LENGTH, true)) {
      throw new RangeError("Descrição do mod é inválida.");
    }

    if (!isTauriRuntime()) {
      throw new Error("Publicação Workshop exige runtime Tauri com Steam.");
    }

    try {
      return await invoke<string>("modding_publish_workshop_item", {
        localFolderPath: normalizedPath,
        title: normalizedTitle,
        description,
      });
    } catch (error: unknown) {
      throw this.wrapInvokeError("publishWorkshopItem", error);
    }
  }

  private wrapInvokeError(operation: string, error: unknown): Error {
    const message = error instanceof Error ? error.message : String(error);
    return new Error(`[TauriModdingDriver.${operation}] ${message}`);
  }
}
