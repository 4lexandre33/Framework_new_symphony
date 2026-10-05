import type {
  Plugin,
  PluginContext,
} from "@core";

import {
  SpritesToken,
} from "../../tokens/sprites";

import {
  LoadTilemapCommand,
  ParallaxScrolledEvent,
  SetParallaxSpeedCommand,
  SpawnSprite2DCommand,
  SpriteAnimationEndedEvent,
  TilemapLoadedEvent,
} from "../../contracts/sprites/types";

import type {
  LoadTilemapRequest,
  SetParallaxSpeedRequest,
  SpawnSprite2DRequest,
} from "../../contracts/sprites/types";

import {
  SpritesService,
} from "../../engine/sprites/internal/SpritesService";

export const spritesManifest:
  Plugin["manifest"] = {
    id:
      "game.sprites",

    name:
      "Instanced 2D Sprite & Tilemap Engine Plugin",

    version:
      "1.0.0",

    kind:
      "preloaded",

    authority:
      "game",

    permissions: {
      capabilities: [
        SpritesToken.id,
      ],

      events: [
        TilemapLoadedEvent.type,
        SpriteAnimationEndedEvent.type,
        ParallaxScrolledEvent.type,
        "game.loop.tick",
      ],
    },

    capabilities: {
      provides: [
        {
          id:
            SpritesToken.id,
          version:
            "1.0.0",
        },
      ],

      conflicts:
        [],
    },
  };

export function createSpritesPlugin():
  Plugin {
  return {
    manifest:
      spritesManifest,

    setup(
      ctx:
        PluginContext,
    ): void {
      const spritesService =
        new SpritesService(
          ctx,
        );

      ctx.caps.provide(
        SpritesToken,
        spritesService,
      );

      ctx.events.define(
        TilemapLoadedEvent,
      );

      ctx.events.define(
        SpriteAnimationEndedEvent,
      );

      ctx.events.define(
        ParallaxScrolledEvent,
      );

      ctx.commands.define(
        LoadTilemapCommand,
      );

      ctx.commands.define(
        SpawnSprite2DCommand,
      );

      ctx.commands.define(
        SetParallaxSpeedCommand,
      );

      const unbindLoad =
        ctx.commands.handle(
          LoadTilemapCommand.type,
          (
            envelope,
          ): void => {
            const payload =
              envelope.payload as
                LoadTilemapRequest;

            spritesService
              .renderTilemap(
                payload.descriptor,
              );
          },
        );

      const unbindSpawn =
        ctx.commands.handle(
          SpawnSprite2DCommand.type,
          (
            envelope,
          ): void => {
            const payload =
              envelope.payload as
                SpawnSprite2DRequest;

            spritesService
              .spawnSprite2D(
                payload.options,
              );
          },
        );

      const unbindParallax =
        ctx.commands.handle(
          SetParallaxSpeedCommand.type,
          (
            envelope,
          ): boolean => {
            const payload =
              envelope.payload as
                SetParallaxSpeedRequest;

            return spritesService
              .setParallaxSpeed(
                payload.layerId,
                payload.factorX,
                payload.factorY,
              );
          },
        );

      ctx.lifecycle.onDispose(
        (): void => {
          unbindLoad();
          unbindSpawn();
          unbindParallax();

          spritesService
            .dispose();
        },
      );

      ctx.lifecycle.ready();
    },
  };
}
