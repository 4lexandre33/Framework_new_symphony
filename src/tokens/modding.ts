import { defineCapability } from "@core";
import type {
  AssetOverrideDescriptor,
  ModManifestDescriptor,
} from "../contracts/modding/types";

export interface ModdingApi {
  getLoadedMods(): ReadonlyArray<ModManifestDescriptor>;
  enableMod(modId: string): Promise<boolean>;
  disableMod(modId: string): boolean;
  getAssetOverride(virtualPath: string): string | null;
  registerAssetOverride(override: AssetOverrideDescriptor): void;
  downloadWorkshopMod(itemId: string): Promise<boolean>;
  publishWorkshopMod(
    localFolderPath: string,
    title: string,
    description: string,
  ): Promise<string>;
  clear(): void;
}

export const ModdingToken = defineCapability<ModdingApi>(
  "game.modding",
  "1.0.0",
);