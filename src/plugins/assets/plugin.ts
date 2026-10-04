import type { Plugin, PluginContext } from "@core";
import { AssetsToken } from "../../tokens/assets";
import { AssetProgressEvent, AssetLoadedEvent } from "../../contracts/assets/types";
import { AssetsManagerService } from "../../engine/assets/internal/AssetsManagerService";

export const assetsManifest: Plugin["manifest"] = {
  id: "game.assets",
  name: "Asset Pipeline & VRAM Cache Plugin",
  version: "1.0.0",
  kind: "preloaded",
  authority: "game",
  permissions: {
    capabilities: [AssetsToken.id],
    events: ["game.assets.progress", "game.assets.loaded"],
  },
  capabilities: {
    provides: [
      {
        id: AssetsToken.id,
        version: "1.0.0",
      },
    ],
    conflicts: [],
  },
};

export function createAssetsPlugin(): Plugin {
  return {
    manifest: assetsManifest,

    setup(ctx: PluginContext) {
      const assetsService = new AssetsManagerService();

      ctx.caps.provide(AssetsToken, assetsService);

      ctx.events.define(AssetProgressEvent);
      ctx.events.define(AssetLoadedEvent);

      ctx.lifecycle.onDispose(() => {
        assetsService.clearCache();
      });

      ctx.lifecycle.ready();
    },
  };
}