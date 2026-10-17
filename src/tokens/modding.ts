import { defineCapability } from "@core";
import type {
  AssetOverrideDescriptor,
  InstallModOptions,
  InstalledModInfo,
  ModManifestDescriptor,
  ModScriptCapability,
  WorkshopItemState,
} from "../contracts/modding/types";

export interface ModdingApi {
  /** Mods ATIVOS em ordem de carga (dependências primeiro). */
  getLoadedMods(): ReadonlyArray<ModManifestDescriptor>;
  /**
   * Ativa o mod (e dependências): registra overrides, executa o
   * `entryScript` no sandbox e persiste a lista de ativos.
   */
  enableMod(modId: string): Promise<boolean>;
  disableMod(modId: string): boolean;
  /**
   * URL do override vencedor (caminho normalizado). Para mods em disco no
   * Tauri é `convertFileSrc(...)` (exige assetProtocol habilitado); prefira
   * `resolveAssetUrl`, que funciona sem configuração.
   */
  getAssetOverride(virtualPath: string): string | null;
  registerAssetOverride(override: AssetOverrideDescriptor): void;
  /** Assina + baixa + aguarda instalação do item do Workshop e o registra. */
  downloadWorkshopMod(itemId: string): Promise<boolean>;
  /**
   * Publica no Workshop a pasta de um mod local (precisa estar em
   * `<app_data>/mods`; aceita o modId). Rejeita sem Tauri/Steam.
   */
  publishWorkshopMod(
    localFolderPath: string,
    title: string,
    description: string,
  ): Promise<string>;
  /**
   * Desativa todos os mods (scripts, overrides, URLs) e limpa overrides
   * manuais, SEM esquecer os mods instalados nem a lista persistida: o
   * módulo continua utilizável.
   */
  clear(): void;

  /** Todos os mods conhecidos (instalados/registrados), válidos e inválidos. */
  getInstalledMods(): ReadonlyArray<InstalledModInfo>;
  /** Reescaneia a pasta de mods e os itens do Workshop (Tauri). */
  refreshInstalledMods(): Promise<ReadonlyArray<InstalledModInfo>>;
  /**
   * Registra um mod fornecido pelo jogo (empacotado/baixado), inclusive
   * offline. O manifesto passa pela mesma validação do Rust.
   */
  installMod(manifest: unknown, options?: InstallModOptions): InstalledModInfo;
  /** URL utilizável do override (blob: para mods em disco). `null` se não há. */
  resolveAssetUrl(virtualPath: string): Promise<string | null>;
  /** Capacidades do script do mod (padrão: `log` e `messages`). */
  setScriptCapabilities(modId: string, capabilities: ReadonlyArray<ModScriptCapability>): void;
  /** Envia uma mensagem ao script do mod (`mod.on(type, handler)`). */
  postToModScript(modId: string, type: string, payload: unknown): boolean;
  /** Estado de download/instalação de um item do Workshop (`null` sem Steam). */
  getWorkshopItemState(itemId: string): Promise<WorkshopItemState | null>;
}

export const ModdingToken = defineCapability<ModdingApi>(
  "game.modding",
  "1.0.0",
);
