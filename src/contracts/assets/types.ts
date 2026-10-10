import { defineEvent } from "@core";

export type AssetType = "gltf" | "texture" | "audio" | "json" | "binary";

export type AssetLoadState = "unloaded" | "loading" | "loaded" | "error";

export interface AssetDescriptor {
  readonly id: string;
  readonly url: string;
  readonly type: AssetType;
  readonly sizeBytes?: number;
}

export interface AssetManifest {
  readonly version: string;
  readonly assets: ReadonlyArray<AssetDescriptor>;
}

/** Espaço de cor de uma textura: "srgb" (cor/albedo, padrão), "linear" ou "none" (normal, roughness, dados). */
export type TextureColorSpace = "srgb" | "linear" | "none";

export interface TextureLoadOptions {
  readonly colorSpace?: TextureColorSpace;
  readonly flipY?: boolean;
}

export interface ManifestPreloadOptions {
  /** Downloads simultâneos (padrão 4). */
  readonly concurrency?: number;
  /** Rejeita no primeiro erro (padrão false: segue e lista em `failed`). */
  readonly failFast?: boolean;
}

export interface ManifestLoadFailure {
  readonly id: string;
  readonly url: string;
  readonly type: AssetType;
  readonly error: string;
}

export interface ManifestLoadResult {
  /** ids carregados (e retidos uma vez cada; libere com `releaseManifest`). */
  readonly loaded: readonly string[];
  readonly failed: readonly ManifestLoadFailure[];
}

export interface ManifestProgressPayload {
  readonly manifestVersion: string;
  readonly loadedCount: number;
  readonly failedCount: number;
  readonly totalCount: number;
  readonly loadedBytes: number;
  /** 0 enquanto desconhecido (sem `sizeBytes` nem content-length). */
  readonly totalBytes: number;
  /** 0..1, por bytes quando conhecidos, senão por contagem com frações parciais. */
  readonly progress: number;
  readonly currentUrl: string;
}

export const ManifestProgressEvent = defineEvent<
  "game.assets.manifest-progress",
  ManifestProgressPayload
>("game.assets.manifest-progress");

export interface AssetLoadFailedPayload {
  readonly id: string;
  readonly url: string;
  readonly type: AssetType;
  readonly error: string;
}

export const AssetLoadFailedEvent = defineEvent<
  "game.assets.load-failed",
  AssetLoadFailedPayload
>("game.assets.load-failed");

export interface AssetProgressPayload {
  readonly url: string;
  readonly loadedBytes: number;
  readonly totalBytes: number;
  readonly progressPercentage: number;
}

export const AssetProgressEvent = defineEvent<
  "game.assets.progress",
  AssetProgressPayload
>("game.assets.progress");

export interface AssetLoadedPayload {
  readonly id: string;
  readonly url: string;
  readonly type: AssetType;
}

export const AssetLoadedEvent = defineEvent<
  "game.assets.loaded",
  AssetLoadedPayload
>("game.assets.loaded");