import * as THREE from "three";
import { defineCapability } from "@core";
import type {
  TextureAtlasJSON,
  TilemapLayerDescriptor,
  ParallaxLayerConfig,
  Sprite2DOptions,
  SpriteAnimationDescriptor,
  UVRect,
} from "../contracts/sprites/types";

/**
 * Sprites 2D, tilemaps e parallax. Consome `game.render` (cena) e
 * `game.assets` (texturas) — ambos opcionais: sem render os objetos são
 * criados mas não entram na cena (G92).
 *
 * Texturas (G95): `parseAtlas` guarda um CLONE próprio da textura do atlas
 * (nearest, sem mipmap); a textura do cache nunca é alterada. Sprite/tilemap
 * de um atlas ainda não parseado fica invisível e aparece quando o
 * `parseAtlas` daquela chave chegar.
 */
export interface SpritesApi {
  parseAtlas(atlasKey: string, json: TextureAtlasJSON, texture: THREE.Texture): void;
  getFrameUV(atlasKey: string, frameName: string): UVRect | null;
  /** Clone próprio da textura do atlas (não descarte), ou null. */
  getAtlasTexture(atlasKey: string): THREE.Texture | null;
  /** Cria/substitui uma camada de tilemap (1 draw call; G93). */
  renderTilemap(descriptor: TilemapLayerDescriptor): THREE.InstancedMesh;
  removeTilemap(layerId: string): boolean;
  /**
   * Cria/substitui camadas de parallax. A textura vem do cache de
   * `game.assets` (carregada se faltar).
   */
  createParallaxBackground(layers: ReadonlyArray<ParallaxLayerConfig>): void;
  removeParallaxLayer(layerId: string): boolean;
  setParallaxSpeed(layerId: string, factorX: number, factorY: number): boolean;
  /** Posiciona as camadas para a câmera em (x, y). Chame quando a câmera mover. */
  updateParallax(cameraX: number, cameraY: number): void;
  spawnSprite2D(options: Sprite2DOptions): THREE.Mesh;
  despawnSprite2D(spriteId: string): boolean;
  /** Malha do sprite (mova/gire à vontade; não descarte), ou null. */
  getSprite(spriteId: string): THREE.Mesh | null;
  /** Mostra um frame fixo (interrompe a animação). false se o frame não existe. */
  setSpriteFrame(spriteId: string, frameName: string): boolean;
  /** Toca uma animação por frames (G94). */
  playSpriteAnimation(spriteId: string, animation: SpriteAnimationDescriptor): boolean;
  stopSpriteAnimation(spriteId: string): boolean;
  setPixelPerfectScaling(
    camera: THREE.OrthographicCamera,
    viewportWidth: number,
    viewportHeight: number,
    designWidth: number,
    designHeight: number
  ): number;
  /** Avança animações. A engine chama no `game.loop.render` (delta 0 pausado). */
  update(deltaSeconds: number): void;
  clear(): void;
}

export const SpritesToken = defineCapability<SpritesApi>("game.sprites", "1.0.0");
