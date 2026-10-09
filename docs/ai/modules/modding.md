# modding — Steam Workshop, Dynamic Loading & Asset Override
capability: game.modding@1.0.0 | category: functional | engine plugin id: game.modding
use (from src/projects/<jogo>/**):
  import { ModdingToken } from "../../tokens/modding";
  // acesso: const api = ctx.caps.require(Token)  (declare o token em capabilities.consumes + permissions.capabilities)

## token src/tokens/modding.ts
```ts
interface ModdingApi {
  getLoadedMods(): ReadonlyArray<ModManifestDescriptor>;
  enableMod(modId: string): Promise<boolean>;
  disableMod(modId: string): boolean;
  getAssetOverride(virtualPath: string): string | null;
  registerAssetOverride(override: AssetOverrideDescriptor): void;
  downloadWorkshopMod(itemId: string): Promise<boolean>;
  publishWorkshopMod( localFolderPath: string, title: string, description: string, ): Promise<string>;
  clear(): void;
}
capability ModdingToken = "game.modding"@1.0.0 api ModdingApi
```
## contract src/contracts/modding/types.ts
```ts
interface ModDependencyDescriptor {
  readonly modId: string;
  readonly minVersion: string;
}
interface ModManifestDescriptor {
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
interface AssetOverrideDescriptor {
  readonly virtualPath: string;
  readonly realPath: string;
  readonly modId: string;
  readonly priority: number;
}
interface SteamWorkshopItemDTO {
  readonly itemId: string;
  readonly title: string;
  readonly description: string;
  readonly ownerSteamId: string;
  readonly fileSizeBytes: number;
  readonly isSubscribed: boolean;
  readonly isDownloading: boolean;
  readonly downloadProgressPercentage: number;
}
interface ScriptSandboxConfig {
  readonly maxExecutionTimeMs: number;
  readonly allowedCapabilities: ReadonlyArray<string>;
}
interface ModLoadedPayload {
  readonly modId: string;
  readonly manifest: ModManifestDescriptor;
}
event ModLoadedEvent = "game.modding.mod-loaded" payload ModLoadedPayload
interface ModUnloadedPayload {
  readonly modId: string;
}
event ModUnloadedEvent = "game.modding.mod-unloaded" payload ModUnloadedPayload
interface WorkshopDownloadProgressPayload {
  readonly itemId: string;
  readonly progressPercentage: number;
  readonly bytesDownloaded: number;
  readonly totalBytes: number;
}
event WorkshopDownloadProgressEvent = "game.modding.workshop-progress" payload WorkshopDownloadProgressPayload
interface AssetOverriddenPayload {
  readonly virtualPath: string;
  readonly realPath: string;
  readonly modId: string;
}
event AssetOverriddenEvent = "game.modding.asset-overridden" payload AssetOverriddenPayload
interface DownloadWorkshopModPayload {
  readonly itemId: string;
}
command DownloadWorkshopModCommand = "game.modding.download-workshop" request DownloadWorkshopModPayload
interface EnableModPayload {
  readonly modId: string;
}
command EnableModCommand = "game.modding.enable-mod" request EnableModPayload
interface DisableModPayload {
  readonly modId: string;
}
command DisableModCommand = "game.modding.disable-mod" request DisableModPayload
interface PublishModToWorkshopPayload {
  readonly localFolderPath: string;
  readonly title: string;
  readonly description: string;
}
command PublishModToWorkshopCommand = "game.modding.publish-workshop" request PublishModToWorkshopPayload
```
