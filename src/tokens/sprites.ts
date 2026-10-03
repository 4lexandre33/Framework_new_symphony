import * as THREE from "three";
import { defineCapability } from "../core/contracts/capability-token";
import type {
  TextureAtlasJSON,
  TilemapLayerDescriptor,
  ParallaxLayerConfig,
  Sprite2DOptions,
  UVRect,
} from "../contracts/sprites/types";

export interface SpritesApi {
  parseAtlas(atlasKey: string, json: TextureAtlasJSON, texture: THREE.Texture): void;
  getFrameUV(atlasKey: string, frameName: string): UVRect | null;
  renderTilemap(descriptor: TilemapLayerDescriptor): THREE.InstancedMesh;
  createParallaxBackground(layers: ReadonlyArray<ParallaxLayerConfig>): void;
  updateParallax(cameraX: number, cameraY: number): void;
  spawnSprite2D(options: Sprite2DOptions): THREE.Mesh;
  despawnSprite2D(spriteId: string): boolean;
  setPixelPerfectScaling(
    camera: THREE.OrthographicCamera,
    viewportWidth: number,
    viewportHeight: number,
    designWidth: number,
    designHeight: number
  ): number;
  clear(): void;
}

export const SpritesToken = defineCapability<SpritesApi>("game.sprites", "1.0.0");