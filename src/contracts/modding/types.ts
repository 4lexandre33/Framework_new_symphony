import { defineEvent, defineCommand } from "@core";

export interface ModDependencyDescriptor {
  readonly modId: string;
  readonly minVersion: string;
}

export interface ModManifestDescriptor {
  readonly modId: string;
  readonly name: string;
  readonly version: string;
  readonly author: string;
  readonly description: string;
  readonly minEngineVersion: string;
  readonly entryScript?: string;
  readonly overrides?: ReadonlyArray<AssetOverrideDescriptor>;
  readonly dependencies?: ReadonlyArray<ModDependencyDescriptor>;
}

export interface AssetOverrideDescriptor {
  readonly virtualPath: string;
  readonly realPath: string;
  readonly modId: string;
  readonly priority: number;
}

export interface SteamWorkshopItemDTO {
  readonly itemId: string;
  readonly title: string;
  readonly description: string;
  readonly ownerSteamId: string;
  readonly fileSizeBytes: number;
  readonly isSubscribed: boolean;
  readonly isDownloading: boolean;
  readonly downloadProgressPercentage: number;
}

export interface ScriptSandboxConfig {
  readonly maxExecutionTimeMs: number;
  readonly allowedCapabilities: ReadonlyArray<string>;
}

// ── EVENTOS DE MODDING ──────────────────────────────────────────────────────

export interface ModLoadedPayload {
  readonly modId: string;
  readonly manifest: ModManifestDescriptor;
}

export const ModLoadedEvent = defineEvent<
  "game.modding.mod-loaded",
  ModLoadedPayload
>("game.modding.mod-loaded");

export interface ModUnloadedPayload {
  readonly modId: string;
}

export const ModUnloadedEvent = defineEvent<
  "game.modding.mod-unloaded",
  ModUnloadedPayload
>("game.modding.mod-unloaded");

export interface WorkshopDownloadProgressPayload {
  readonly itemId: string;
  readonly progressPercentage: number;
  readonly bytesDownloaded: number;
  readonly totalBytes: number;
}

export const WorkshopDownloadProgressEvent = defineEvent<
  "game.modding.workshop-progress",
  WorkshopDownloadProgressPayload
>("game.modding.workshop-progress");

export interface AssetOverriddenPayload {
  readonly virtualPath: string;
  readonly realPath: string;
  readonly modId: string;
}

export const AssetOverriddenEvent = defineEvent<
  "game.modding.asset-overridden",
  AssetOverriddenPayload
>("game.modding.asset-overridden");

// ── COMANDOS DE MODDING ─────────────────────────────────────────────────────

export interface DownloadWorkshopModPayload {
  readonly itemId: string;
}

export const DownloadWorkshopModCommand = defineCommand<
  "game.modding.download-workshop",
  DownloadWorkshopModPayload
>("game.modding.download-workshop");

export interface EnableModPayload {
  readonly modId: string;
}

export const EnableModCommand = defineCommand<
  "game.modding.enable-mod",
  EnableModPayload
>("game.modding.enable-mod");

export interface DisableModPayload {
  readonly modId: string;
}

export const DisableModCommand = defineCommand<
  "game.modding.disable-mod",
  DisableModPayload
>("game.modding.disable-mod");

export interface PublishModToWorkshopPayload {
  readonly localFolderPath: string;
  readonly title: string;
  readonly description: string;
}

// ── API ADICIONAL (G14, G116–G118) ──────────────────────────────────────────

/**
 * Versão da API de modding. `minEngineVersion` do manifesto é comparado com
 * ela (semver `>=`); vazio = qualquer versão.
 */
export const MODDING_API_VERSION = "1.0.0";

/** `local`: pasta `<app_data>/mods`; `workshop`: item Steam instalado; `game`: registrado pelo jogo (`installMod`). */
export type ModSource = "local" | "workshop" | "game";

export interface InstalledModInfo {
  /** `null` quando o manifesto é inválido. */
  readonly modId: string | null;
  readonly manifest: ModManifestDescriptor | null;
  readonly source: ModSource;
  /** Pasta canônica em disco (`null` para mods do jogo). */
  readonly rootPath: string | null;
  readonly workshopItemId: string | null;
  readonly enabled: boolean;
  /** Motivo da rejeição (manifesto inválido) — o mod não some sem aviso. */
  readonly error: string | null;
}

/**
 * Capacidades do script de mod (sandbox em Worker):
 * - `log`: `mod.log(...)` vai para o log do plugin;
 * - `messages`: `mod.send(type, data)` vira `game.modding.script-message`;
 * - `assets`: `mod.registerAssetOverride(virtualPath, realPath, priority)`.
 */
export type ModScriptCapability = "log" | "messages" | "assets";

export interface InstallModOptions {
  /** Código do `entryScript` (mods empacotados/baixados pelo jogo). */
  readonly scriptSource?: string;
  /** Base para resolver `realPath` relativos dos overrides (ex.: `/mods/hd/`). */
  readonly baseUrl?: string;
  /** Substitui um mod já instalado com o mesmo `modId` (padrão false). */
  readonly replace?: boolean;
}

export interface WorkshopItemState {
  readonly itemId: string;
  readonly subscribed: boolean;
  readonly installed: boolean;
  readonly downloading: boolean;
  readonly downloadPending: boolean;
  readonly needsUpdate: boolean;
  readonly bytesDownloaded: number;
  readonly bytesTotal: number;
}

export interface ModScriptMessagePayload {
  readonly modId: string;
  readonly type: string;
  readonly data: unknown;
}

/** Mensagem enviada por um script de mod (`mod.send`) com capacidade `messages`. */
export const ModScriptMessageEvent = defineEvent<
  "game.modding.script-message",
  ModScriptMessagePayload
>("game.modding.script-message");

export interface ModErrorPayload {
  readonly modId: string;
  readonly error: string;
}

/** Falha de script/instalação/ativação de um mod. */
export const ModErrorEvent = defineEvent<
  "game.modding.mod-error",
  ModErrorPayload
>("game.modding.mod-error");

export const PublishModToWorkshopCommand = defineCommand<
  "game.modding.publish-workshop",
  PublishModToWorkshopPayload
>("game.modding.publish-workshop");