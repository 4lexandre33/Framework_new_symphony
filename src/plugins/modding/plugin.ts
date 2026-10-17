import type { Plugin, PluginContext } from "@core";
import { ModdingToken } from "../../tokens/modding";
import { AssetOverriddenEvent, DisableModCommand, DownloadWorkshopModCommand, EnableModCommand, ModErrorEvent, ModLoadedEvent, ModScriptMessageEvent, ModUnloadedEvent, PublishModToWorkshopCommand, WorkshopDownloadProgressEvent, type DisableModPayload, type DownloadWorkshopModPayload, type EnableModPayload, type PublishModToWorkshopPayload } from "../../contracts/modding/types";
import { ModdingService, type ModdingServiceOptions } from "../../engine/modding/internal/ModdingService";

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
      ModScriptMessageEvent.type,
      ModErrorEvent.type,
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

export function createModdingPlugin(options: ModdingServiceOptions = {}): Plugin {
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
      const service = new ModdingService(ctx, options);
      moddingService = service;

      ctx.caps.provide(ModdingToken, service);

      ctx.events.define(ModLoadedEvent);
      ctx.events.define(ModUnloadedEvent);
      ctx.events.define(WorkshopDownloadProgressEvent);
      ctx.events.define(AssetOverriddenEvent);
      ctx.events.define(ModScriptMessageEvent);
      ctx.events.define(ModErrorEvent);

      const unbindWorkshopResult = ctx.events.on<
        "game.steam.workshop-download-result",
        { publishedFileId: string; success: boolean; error?: string }
      >("game.steam.workshop-download-result", (envelope): void => {
        service.handleWorkshopDownloadResult(
          envelope.payload.publishedFileId,
          envelope.payload.success,
          envelope.payload.error,
        );
      });

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
        unbindWorkshopResult();
        // dispose (não clear): não reescreve a lista persistida de mods ativos.
        service.dispose();

        if (moddingService === service) {
          moddingService = null;
        }
      });

      ctx.lifecycle.ready();
    },
  };
}