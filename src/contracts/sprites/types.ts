import { defineEvent, defineCommand } from "../../core/contracts";

export interface AtlasFrameBounds {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface AtlasFrameData {
  readonly filename: string;
  readonly frame: AtlasFrameBounds;
  readonly rotated: boolean;
  readonly trimmed: boolean;
  readonly spriteSourceSize: AtlasFrameBounds;
  readonly sourceSize: { readonly w: number; readonly h: number };
}

export interface TextureAtlasJSON {
  readonly frames: Record<string, AtlasFrameData> | ReadonlyArray<AtlasFrameData>;
  readonly meta: {
    readonly image: string;
    readonly size: { readonly w: number; readonly h: number };
    readonly scale: string;
  };
}

export interface UVRect {
  readonly u: number;
  readonly v: number;
  readonly w: number;
  readonly h: number;
}

export interface TileDataMatrix {
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  readonly tiles: ReadonlyArray<number>;
}

export interface TilemapLayerDescriptor {
  readonly layerId: string;
  readonly atlasUrl: string;
  readonly tileMatrix: TileDataMatrix;
  readonly position?: { readonly x: number; readonly y: number; readonly z: number };
  readonly renderOrder?: number;
}

export interface ParallaxLayerConfig {
  readonly layerId: string;
  readonly textureUrl: string;
  readonly factorX: number;
  readonly factorY: number;
  readonly depthZ?: number;
  readonly repeatX?: boolean;
  readonly repeatY?: boolean;
}

export interface PixelArtCameraConfig {
  readonly designWidth: number;
  readonly designHeight: number;
  readonly pixelRatio?: number;
}

export interface Sprite2DOptions {
  readonly spriteId: string;
  readonly atlasUrl: string;
  readonly frameName: string;
  readonly position: { readonly x: number; readonly y: number; readonly z?: number };
  readonly scale?: { readonly x: number; readonly y: number };
  readonly rotation?: number;
  readonly flipX?: boolean;
  readonly flipY?: boolean;
  readonly renderOrder?: number;
}

// ── EVENTOS DE SPRITES 2D ──────────────────────────────────────────────────

export interface TilemapLoadedPayload {
  readonly layerId: string;
  readonly totalTiles: number;
  readonly drawCallCount: number;
}

export const TilemapLoadedEvent = defineEvent<
  "game.sprites.tilemap-loaded",
  TilemapLoadedPayload
>("game.sprites.tilemap-loaded");

export interface SpriteAnimationEndedPayload {
  readonly spriteId: string;
  readonly animationName: string;
}

export const SpriteAnimationEndedEvent = defineEvent<
  "game.sprites.animation-ended",
  SpriteAnimationEndedPayload
>("game.sprites.animation-ended");

export interface ParallaxScrolledPayload {
  readonly cameraPosition: { readonly x: number; readonly y: number };
}

export const ParallaxScrolledEvent = defineEvent<
  "game.sprites.parallax-scrolled",
  ParallaxScrolledPayload
>("game.sprites.parallax-scrolled");

// ── COMANDOS DE SPRITES 2D ──────────────────────────────────────────────────

export interface LoadTilemapRequest {
  readonly descriptor: TilemapLayerDescriptor;
}

export const LoadTilemapCommand = defineCommand<
  "game.sprites.load-tilemap",
  LoadTilemapRequest
>("game.sprites.load-tilemap");

export interface SpawnSprite2DRequest {
  readonly options: Sprite2DOptions;
}

export const SpawnSprite2DCommand = defineCommand<
  "game.sprites.spawn-sprite",
  SpawnSprite2DRequest
>("game.sprites.spawn-sprite");

export interface SetParallaxSpeedRequest {
  readonly layerId: string;
  readonly factorX: number;
  readonly factorY: number;
}

export const SetParallaxSpeedCommand = defineCommand<
  "game.sprites.set-parallax-speed",
  SetParallaxSpeedRequest
>("game.sprites.set-parallax-speed");