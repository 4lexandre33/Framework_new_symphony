import * as THREE from "three";
import type { Plugin, PluginContext } from "../../core/contracts/plugin-context";
import { SpritesToken, type SpritesApi } from "../../tokens/sprites";
import { AssetsToken, type AssetsApi } from "../../tokens/assets";
import { RenderToken, type Render3DApi } from "../../tokens/render";
import {
  TilemapLoadedEvent,
  SpriteAnimationEndedEvent,
  ParallaxScrolledEvent,
  LoadTilemapCommand,
  SpawnSprite2DCommand,
  SetParallaxSpeedCommand,
  type TextureAtlasJSON,
  type TilemapLayerDescriptor,
  type ParallaxLayerConfig,
  type Sprite2DOptions,
  type UVRect,
} from "../../contracts/sprites/types";
import { TextureAtlasParser } from "../../engine/sprites/TextureAtlasParser";
import { InstancedTilemapRenderer } from "../../engine/sprites/InstancedTilemapRenderer";
import { ParallaxController } from "../../engine/sprites/ParallaxController";
import { PixelArtScaler } from "../../engine/sprites/PixelArtScaler";
import { Sprite2DRenderer } from "../../engine/sprites/Sprite2DRenderer";

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
  },
};

export class SpritesService implements SpritesApi {
  private readonly atlasParser = new TextureAtlasParser();
  private readonly tilemapRenderer = new InstancedTilemapRenderer(this.atlasParser);
  private readonly parallaxController = new ParallaxController();
  private readonly spriteRenderer = new Sprite2DRenderer(this.atlasParser);

  public constructor(private readonly ctx: PluginContext) {}

  public parseAtlas(atlasKey: string, json: TextureAtlasJSON, texture: THREE.Texture): void {
    this.atlasParser.parseAtlas(atlasKey, json, texture);
  }

  public getFrameUV(atlasKey: string, frameName: string): UVRect | null {
    return this.atlasParser.getFrameUV(atlasKey, frameName);
  }

  public renderTilemap(descriptor: TilemapLayerDescriptor): THREE.InstancedMesh {
    const assets = this.ctx.caps.get(AssetsToken) as AssetsApi | null;
    const render = this.ctx.caps.get(RenderToken) as Render3DApi | null;

    const texture = assets?.getAsset<THREE.Texture>(descriptor.atlasUrl) || new THREE.Texture();
    const instancedMesh = this.tilemapRenderer.renderTilemap(descriptor, texture);

    if (render) {
      render.addMeshToScene(`tilemap_${descriptor.layerId}`, instancedMesh);
    }

    this.ctx.events.emit("game.sprites.tilemap-loaded", {
      layerId: descriptor.layerId,
      totalTiles: instancedMesh.count,
      drawCallCount: 1,
    });

    return instancedMesh;
  }

  public createParallaxBackground(layers: ReadonlyArray<ParallaxLayerConfig>): void {
    const assets = this.ctx.caps.get(AssetsToken) as AssetsApi | null;
    const render = this.ctx.caps.get(RenderToken) as Render3DApi | null;

    for (const config of layers) {
      const texture = assets?.getAsset<THREE.Texture>(config.textureUrl) || new THREE.Texture();
      const mesh = this.parallaxController.createLayer(config, texture);

      if (render) {
        render.addMeshToScene(`parallax_${config.layerId}`, mesh);
      }
    }
  }

  public updateParallax(cameraX: number, cameraY: number): void {
    this.parallaxController.update(cameraX, cameraY);
    this.ctx.events.emit("game.sprites.parallax-scrolled", {
      cameraPosition: { x: cameraX, y: cameraY },
    });
  }

  public spawnSprite2D(options: Sprite2DOptions): THREE.Mesh {
    const assets = this.ctx.caps.get(AssetsToken) as AssetsApi | null;
    const render = this.ctx.caps.get(RenderToken) as Render3DApi | null;

    const texture = assets?.getAsset<THREE.Texture>(options.atlasUrl) || new THREE.Texture();
    const mesh = this.spriteRenderer.spawnSprite(options, texture);

    if (render) {
      render.addMeshToScene(`sprite_${options.spriteId}`, mesh);
    }

    return mesh;
  }

  public despawnSprite2D(spriteId: string): boolean {
    const render = this.ctx.caps.get(RenderToken) as Render3DApi | null;
    if (render) {
      render.removeMeshFromScene(`sprite_${spriteId}`);
    }
    return this.spriteRenderer.despawnSprite(spriteId);
  }

  public setPixelPerfectScaling(
    camera: THREE.OrthographicCamera,
    viewportWidth: number,
    viewportHeight: number,
    designWidth: number,
    designHeight: number
  ): number {
    return PixelArtScaler.applyPixelPerfectZoom(
      camera,
      viewportWidth,
      viewportHeight,
      designWidth,
      designHeight
    );
  }

  public clear(): void {
    this.atlasParser.clear();
    this.tilemapRenderer.clear();
    this.parallaxController.clear();
    this.spriteRenderer.clear();
  }
}

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