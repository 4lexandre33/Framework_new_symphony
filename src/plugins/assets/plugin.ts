import type {
  Plugin,
  PluginContext,
} from "@core";

import {
  AssetLoadedEvent,
  AssetLoadFailedEvent,
  AssetProgressEvent,
  ManifestProgressEvent,
} from "../../contracts/assets/types";

import {
  AssetsManagerService,
} from "../../engine/assets/internal/AssetsManagerService";

import type {
  AssetLoaderSet,
} from "../../engine/assets/internal/AssetsManagerService";

export interface AssetsPluginOptions {
  /** Substitui loaders (testes em node, hosts sem DOM/Web Audio). */
  readonly loaders?: Partial<AssetLoaderSet>;
  /** Base para resolver URLs relativas (padrão document.baseURI/location). */
  readonly baseUrl?: string;
  /** fetch dos loaders padrão (json, binary, áudio, textura). */
  readonly fetch?: (input: string) => Promise<Response>;
}

import {
  AssetsToken,
} from "../../tokens/assets";

export const assetsManifest:
  Plugin["manifest"] = {
    id:
      "game.assets",

    name:
      "Asset Pipeline & VRAM Cache Plugin",

    version:
      "1.0.0",

    kind:
      "preloaded",

    authority:
      "game",

    permissions: {
      capabilities: [
        AssetsToken.id,
      ],

      events: [
        AssetProgressEvent.type,
        AssetLoadedEvent.type,
        ManifestProgressEvent.type,
        AssetLoadFailedEvent.type,
      ],
    },

    capabilities: {
      provides: [
        {
          id:
            AssetsToken.id,

          version:
            "1.0.0",
        },
      ],

      conflicts:
        [],
    },
  };

export function createAssetsPlugin(
  options:
    AssetsPluginOptions =
      {},
):
  Plugin {
  return {
    manifest:
      assetsManifest,

    setup(
      ctx:
        PluginContext,
    ): void {
      const assetsService =
        new AssetsManagerService({
          onProgress(
            url,
            loadedBytes,
            totalBytes,
          ): void {
            const progressPercentage =
              totalBytes >
                0
                ? Math.min(
                    100,
                    Math.max(
                      0,
                      (
                        loadedBytes /
                        totalBytes
                      ) *
                        100,
                    ),
                  )
                : 0;

            ctx.events.emit(
              AssetProgressEvent.type,
              {
                url,
                loadedBytes,
                totalBytes,
                progressPercentage,
              },
            );
          },

          onLoaded(
            id,
            url,
            type,
          ): void {
            ctx.events.emit(
              AssetLoadedEvent.type,
              {
                id,
                url,
                type,
              },
            );
          },

          onLoadFailed(
            id,
            url,
            type,
            error,
          ): void {
            ctx.events.emit(
              AssetLoadFailedEvent.type,
              {
                id,
                url,
                type,
                error,
              },
            );
          },

          onManifestProgress(
            payload,
          ): void {
            ctx.events.emit(
              ManifestProgressEvent.type,
              payload,
            );
          },
        },
        options.loaders,
        {
          baseUrl:
            options.baseUrl,
          fetch:
            options.fetch,
        });

      ctx.caps.provide(
        AssetsToken,
        assetsService,
      );

      ctx.events.define(
        AssetProgressEvent,
      );

      ctx.events.define(
        AssetLoadedEvent,
      );

      ctx.events.define(
        ManifestProgressEvent,
      );

      ctx.events.define(
        AssetLoadFailedEvent,
      );

      ctx.lifecycle.onDispose(
        (): void => {
          assetsService.dispose();
        },
      );

      ctx.lifecycle.ready();
    },
  };
}
