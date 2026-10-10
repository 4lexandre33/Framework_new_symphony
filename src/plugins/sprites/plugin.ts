import type {
  Plugin,
  PluginContext,
} from "@core";

import {
  SpritesToken,
} from "../../tokens/sprites";

import {
  AssetsToken,
} from "../../tokens/assets";

import {
  RenderToken,
} from "../../tokens/render";

import type {
  GameRenderPayload,
} from "../../contracts/game-loop/types";

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

    // Ordem de boot/shutdown: sprites depois de render/assets (opcionais).
    dependsOn: [
      {
        id:
          "game.render",
        range:
          "^1.0.0",
        optional:
          true,
      },
      {
        id:
          "game.assets",
        range:
          "^1.0.0",
        optional:
          true,
      },
    ],

    // G92: o plugin usa render (cena) e assets (texturas); sem declarar
    // `consumes`/permissão, `ctx.caps.get` lançava em toda operação de cena.
    // Ambos opcionais: sem eles atlas/UV continuam funcionando (headless).
    permissions: {
      capabilities: [
        SpritesToken.id,
        RenderToken.id,
        AssetsToken.id,
      ],

      events: [
        TilemapLoadedEvent.type,
        SpriteAnimationEndedEvent.type,
        ParallaxScrolledEvent.type,
        "game.loop.tick",
        "game.loop.render",
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

      consumes: [
        {
          id:
            RenderToken.id,
          range:
            "^1.0.0",
          optional:
            true,
        },
        {
          id:
            AssetsToken.id,
          range:
            "^1.0.0",
          optional:
            true,
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

      // G94: animações de sprite avançam com o delta do frame (0 pausado).
      const unbindRender =
        ctx.events.on(
          "game.loop.render",
          (
            envelope,
          ): void => {
            const payload =
              envelope.payload as
                GameRenderPayload;

            spritesService.update(
              payload.deltaSeconds,
            );
          },
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
          unbindRender();
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
