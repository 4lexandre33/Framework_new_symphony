import type { Plugin, PluginContext } from "../../core/contracts/plugin-context";
import { AssetsToken, type AssetsApi } from "../../tokens/assets";
import { AssetProgressEvent, AssetLoadedEvent } from "../../contracts/assets/types";
import { AssetCache } from "../../engine/assets/AssetCache";
import { GLTFLoaderService } from "../../engine/assets/GLTFLoaderService";
import { TextureLoaderService } from "../../engine/assets/TextureLoaderService";
import { AudioLoaderService } from "../../engine/assets/AudioLoaderService";

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
  },
};

export class AssetsManagerService implements AssetsApi {
  private readonly cache = new AssetCache();
  private readonly gltfLoader = new GLTFLoaderService(this.cache);
  private readonly textureLoader = new TextureLoaderService(this.cache);
  private readonly audioLoader = new AudioLoaderService(this.cache);

  async loadGLTF(url: string): Promise<any> {
    return await this.gltfLoader.load(url);
  }

  async loadTexture(url: string): Promise<any> {
    return await this.textureLoader.load(url);
  }

  async loadAudio(url: string): Promise<AudioBuffer> {
    return await this.audioLoader.load(url);
  }

  releaseAsset(url: string): void {
    this.cache.release(url);
  }

  getAsset<T = any>(url: string): T | null {
    return this.cache.get<T>(url);
  }

  clearCache(): void {
    this.cache.clear();
  }
}

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