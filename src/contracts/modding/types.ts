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

export const PublishModToWorkshopCommand = defineCommand<
  "game.modding.publish-workshop",
  PublishModToWorkshopPayload
>("game.modding.publish-workshop");