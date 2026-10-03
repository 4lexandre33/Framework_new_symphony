import { defineEvent } from "../../core/contracts";

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