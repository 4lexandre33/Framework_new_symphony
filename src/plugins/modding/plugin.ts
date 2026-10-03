import type {
  Plugin,
  PluginContext,
} from "../../core/contracts/plugin-context";
import { KERNEL_API_VERSION } from "../../core/contracts/kernel-version";
import {
  ModdingToken,
  type ModdingApi,
} from "../../tokens/modding";
import {
  AssetOverriddenEvent,
  DisableModCommand,
  DownloadWorkshopModCommand,
  EnableModCommand,
  ModLoadedEvent,
  ModUnloadedEvent,
  PublishModToWorkshopCommand,
  WorkshopDownloadProgressEvent,
  type AssetOverrideDescriptor,
  type DisableModPayload,
  type DownloadWorkshopModPayload,
  type EnableModPayload,
  type ModManifestDescriptor,
  type PublishModToWorkshopPayload,
} from "../../contracts/modding/types";
import { AssetOverrideRegistry } from "../../engine/modding/AssetOverrideRegistry";
import { DynamicPluginLoader } from "../../engine/modding/DynamicPluginLoader";
import { ScriptSandbox } from "../../engine/modding/ScriptSandbox";
import { SteamWorkshopDriver } from "../../engine/modding/SteamWorkshopDriver";
import { TauriModdingDriver } from "../../engine/modding/TauriModdingDriver";

export const moddingManifest: Plugin["manifest"] = {
  id: "game.modding",
  name: "Steam Workshop & Dynamic Modding Plugin",
  version: "1.0.0",
  kind: "preloaded",
  authority: "game",
  permissions: {
    capabilities: [ModdingToken.id],
    events: [
      ModLoadedEvent.type,
      ModUnloadedEvent.type,
      WorkshopDownloadProgressEvent.type,
      AssetOverriddenEvent.type,
    ],
  },
  capabilities: {
    provides: [
      {
        id: ModdingToken.id,
        version: "1.0.0",
      },
    ],
  },
};

export class ModdingService implements ModdingApi {
  private readonly registry = new AssetOverrideRegistry();
  private readonly loader = new DynamicPluginLoader();
  private readonly workshopDriver = new SteamWorkshopDriver();
  private readonly tauriDriver = new TauriModdingDriver();
  private readonly sandbox = new ScriptSandbox({
    maxExecutionTimeMs: 5_000,
    allowedCapabilities: [],
  });
  private readonly enabledModIds = new Set<string>();

  public constructor(
    private readonly ctx: PluginContext,
  ) {}

  public async initialize(): Promise<void> {
    let manifests: ReadonlyArray<ModManifestDescriptor>;

    try {
      manifests = await this.tauriDriver.scanLocalMods();
    } catch (error: unknown) {
      this.ctx.log.warn("Falha ao escanear mods locais.", {
        error: this.getErrorMessage(error),
      });
      return;
    }

    for (const manifest of manifests) {
      try {
        this.loader.registerMod(manifest);
      } catch (error: unknown) {
        this.ctx.log.warn("Manifesto de mod local ignorado.", {
          modId: manifest.modId,
          error: this.getErrorMessage(error),
        });
      }
    }
  }

  public getLoadedMods(): ReadonlyArray<ModManifestDescriptor> {
    if (this.enabledModIds.size === 0) return [];

    try {
      return this.loader.resolveLoadOrder(
        Array.from(this.enabledModIds),
      );
    } catch (error: unknown) {
      this.ctx.log.error("Estado de dependências de mods ativos ficou inválido.", {
        error: this.getErrorMessage(error),
      });
      return [];
    }
  }

  public async enableMod(
    modId: string,
  ): Promise<boolean> {
    const normalizedModId = modId.trim();
    if (normalizedModId.length === 0) return false;
    if (this.enabledModIds.has(normalizedModId)) return true;

    let loadOrder: ReadonlyArray<ModManifestDescriptor>;

    try {
      loadOrder = this.loader.resolveLoadOrder([normalizedModId]);
    } catch (error: unknown) {
      this.ctx.log.warn("Não foi possível resolver dependências do mod.", {
        modId: normalizedModId,
        error: this.getErrorMessage(error),
      });
      return false;
    }

    for (const manifest of loadOrder) {
      if (!this.loader.validateEngineCompatibility(manifest, KERNEL_API_VERSION)) {
        this.ctx.log.warn("Mod incompatível com a versão atual da engine.", {
          modId: manifest.modId,
          modVersion: manifest.version,
          minEngineVersion: manifest.minEngineVersion,
          engineVersion: KERNEL_API_VERSION,
        });
        return false;
      }
    }

    for (const manifest of loadOrder) {
      if (this.enabledModIds.has(manifest.modId)) continue;

      for (const override of manifest.overrides ?? []) {
        this.registry.registerOverride(override);
        this.emitAssetOverridden(override);
      }

      this.enabledModIds.add(manifest.modId);
      this.ctx.events.emit(ModLoadedEvent.type, {
        modId: manifest.modId,
        manifest,
      });
    }

    return true;
  }

  public disableMod(
    modId: string,
  ): boolean {
    const normalizedModId = modId.trim();
    if (!this.enabledModIds.has(normalizedModId)) return false;

    const enabledDependents = this.loader
      .getDependents(normalizedModId)
      .filter((manifest): boolean => this.enabledModIds.has(manifest.modId));

    if (enabledDependents.length > 0) {
      this.ctx.log.warn("Mod não pode ser desativado enquanto dependentes estão ativos.", {
        modId: normalizedModId,
        dependents: enabledDependents.map((manifest): string => manifest.modId),
      });
      return false;
    }

    this.enabledModIds.delete(normalizedModId);
    this.registry.removeOverridesForMod(normalizedModId);

    this.ctx.events.emit(ModUnloadedEvent.type, {
      modId: normalizedModId,
    });

    return true;
  }

  public getAssetOverride(
    virtualPath: string,
  ): string | null {
    return this.registry.resolveOverride(virtualPath);
  }

  public registerAssetOverride(
    override: AssetOverrideDescriptor,
  ): void {
    this.registry.registerOverride(override);
    this.emitAssetOverridden(override);
  }

  public async downloadWorkshopMod(
    itemId: string,
  ): Promise<boolean> {
    const normalizedItemId = itemId.trim();
    if (!/^\d+$/.test(normalizedItemId)) return false;

    const success = await this.tauriDriver.downloadWorkshopItem(normalizedItemId);
    if (!success) return false;

    const trackedItem = this.workshopDriver.getItem(normalizedItemId);
    if (trackedItem) {
      this.workshopDriver.updateDownloadProgress(normalizedItemId, 100);
    }

    const totalBytes = trackedItem?.fileSizeBytes ?? 0;

    this.ctx.events.emit(WorkshopDownloadProgressEvent.type, {
      itemId: normalizedItemId,
      progressPercentage: 100,
      bytesDownloaded: totalBytes,
      totalBytes,
    });

    return true;
  }

  public async publishWorkshopMod(
    localFolderPath: string,
    title: string,
    description: string,
  ): Promise<string> {
    return this.tauriDriver.publishWorkshopItem(
      localFolderPath,
      title,
      description,
    );
  }

  public clear(): void {
    this.enabledModIds.clear();
    this.registry.clear();
    this.loader.clear();
    this.workshopDriver.clear();
    this.sandbox.terminate();
  }

  private emitAssetOverridden(
    override: AssetOverrideDescriptor,
  ): void {
    this.ctx.events.emit(AssetOverriddenEvent.type, {
      virtualPath: override.virtualPath,
      realPath: override.realPath,
      modId: override.modId,
    });
  }

  private getErrorMessage(
    error: unknown,
  ): string {
    return error instanceof Error ? error.message : String(error);
  }
}

export function createModdingPlugin(): Plugin {
  let moddingService: ModdingService | null = null;

  const manifest: Plugin["manifest"] = {
    ...moddingManifest,
    lifecycleHooks: {
      onBoot: async (): Promise<void> => {
        if (!moddingService) {
          throw new Error("ModdingService não foi criado durante setup().");
        }

        await moddingService.initialize();
      },
    },
  };

  return {
    manifest,

    setup(ctx: PluginContext): void {
      const service = new ModdingService(ctx);
      moddingService = service;

      ctx.caps.provide(ModdingToken, service);

      ctx.events.define(ModLoadedEvent);
      ctx.events.define(ModUnloadedEvent);
      ctx.events.define(WorkshopDownloadProgressEvent);
      ctx.events.define(AssetOverriddenEvent);

      ctx.commands.define(DownloadWorkshopModCommand);
      ctx.commands.define(EnableModCommand);
      ctx.commands.define(DisableModCommand);
      ctx.commands.define(PublishModToWorkshopCommand);

      const unbindDownload = ctx.commands.handle(
        DownloadWorkshopModCommand.type,
        (envelope): Promise<boolean> => {
          const payload = envelope.payload as DownloadWorkshopModPayload;
          return service.downloadWorkshopMod(payload.itemId);
        },
      );

      const unbindEnable = ctx.commands.handle(
        EnableModCommand.type,
        (envelope): Promise<boolean> => {
          const payload = envelope.payload as EnableModPayload;
          return service.enableMod(payload.modId);
        },
      );

      const unbindDisable = ctx.commands.handle(
        DisableModCommand.type,
        (envelope): boolean => {
          const payload = envelope.payload as DisableModPayload;
          return service.disableMod(payload.modId);
        },
      );

      const unbindPublish = ctx.commands.handle(
        PublishModToWorkshopCommand.type,
        (envelope): Promise<string> => {
          const payload = envelope.payload as PublishModToWorkshopPayload;
          return service.publishWorkshopMod(
            payload.localFolderPath,
            payload.title,
            payload.description,
          );
        },
      );

      ctx.lifecycle.onDispose((): void => {
        unbindDownload();
        unbindEnable();
        unbindDisable();
        unbindPublish();
        service.clear();

        if (moddingService === service) {
          moddingService = null;
        }
      });

      ctx.lifecycle.ready();
    },
  };
}
