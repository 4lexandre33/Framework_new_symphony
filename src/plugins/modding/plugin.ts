import type { Plugin, PluginContext } from "@core";
import { ModdingToken } from "../../tokens/modding";
import { AssetOverriddenEvent, DisableModCommand, DownloadWorkshopModCommand, EnableModCommand, ModLoadedEvent, ModUnloadedEvent, PublishModToWorkshopCommand, WorkshopDownloadProgressEvent, type DisableModPayload, type DownloadWorkshopModPayload, type EnableModPayload, type PublishModToWorkshopPayload } from "../../contracts/modding/types";
import { ModdingService } from "../../engine/modding/internal/ModdingService";

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
    conflicts: [],
  },
};

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