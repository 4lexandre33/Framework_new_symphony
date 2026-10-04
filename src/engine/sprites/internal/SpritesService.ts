import * as THREE from "three";
import type { PluginContext } from "@core";
import { type SpritesApi } from "../../../tokens/sprites";
import { AssetsToken, type AssetsApi } from "../../../tokens/assets";
import { RenderToken, type Render3DApi } from "../../../tokens/render";
import { type TextureAtlasJSON, type TilemapLayerDescriptor, type ParallaxLayerConfig, type Sprite2DOptions, type UVRect } from "../../../contracts/sprites/types";
import { TextureAtlasParser } from "./TextureAtlasParser";
import { InstancedTilemapRenderer } from "./InstancedTilemapRenderer";
import { ParallaxController } from "./ParallaxController";
import { PixelArtScaler } from "./PixelArtScaler";
import { Sprite2DRenderer } from "./Sprite2DRenderer";

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
