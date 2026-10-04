import type { Plugin, PluginContext } from "@core";
import { SpritesToken } from "../../tokens/sprites";
import { TilemapLoadedEvent, SpriteAnimationEndedEvent, ParallaxScrolledEvent, LoadTilemapCommand, SpawnSprite2DCommand, SetParallaxSpeedCommand, type TilemapLayerDescriptor, type Sprite2DOptions } from "../../contracts/sprites/types";
import { SpritesService } from "../../engine/sprites/internal/SpritesService";

export const spritesManifest: Plugin["manifest"] = {
  id: "game.sprites",
  name: "Instanced 2D Sprite & Tilemap Engine Plugin",
  version: "1.0.0",
  kind: "preloaded",
  authority: "game",
  permissions: {
    capabilities: [SpritesToken.id],
    events: [
      "game.sprites.tilemap-loaded",
      "game.sprites.animation-ended",
      "game.sprites.parallax-scrolled",
      "game.loop.tick",
    ],
  },
  capabilities: {
    provides: [
      {
        id: SpritesToken.id,
        version: "1.0.0",
      },
    ],
    conflicts: [],
  },
};

export function createSpritesPlugin(): Plugin {
  return {
    manifest: spritesManifest,

    setup(ctx: PluginContext) {
      const spritesService = new SpritesService(ctx);

      ctx.caps.provide(SpritesToken, spritesService);

      ctx.events.define(TilemapLoadedEvent);
      ctx.events.define(SpriteAnimationEndedEvent);
      ctx.events.define(ParallaxScrolledEvent);

      ctx.commands.define(LoadTilemapCommand);
      ctx.commands.define(SpawnSprite2DCommand);
      ctx.commands.define(SetParallaxSpeedCommand);

      const unbindLoad = ctx.commands.handle("game.sprites.load-tilemap", (env) => {
        const p = env.payload as { descriptor: TilemapLayerDescriptor };
        spritesService.renderTilemap(p.descriptor);
      });

      const unbindSpawn = ctx.commands.handle("game.sprites.spawn-sprite", (env) => {
        const p = env.payload as { options: Sprite2DOptions };
        spritesService.spawnSprite2D(p.options);
      });

      ctx.lifecycle.onDispose(() => {
        unbindLoad();
        unbindSpawn();
        spritesService.clear();
      });

      ctx.lifecycle.ready();
    },
  };
}