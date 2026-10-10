import { defineEvent, defineCommand } from "@core";

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

/**
 * Retângulo do frame no atlas em UV (origem embaixo à esquerda). Para
 * frames `rotated` é a região GIRADA ocupada no atlas (w/h trocados).
 */
export interface UVRect {
  readonly u: number;
  readonly v: number;
  readonly w: number;
  readonly h: number;
  readonly rotated?: boolean;
}

export interface TileDataMatrix {
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  readonly tiles: ReadonlyArray<number>;
}

/**
 * Camada de tilemap (uma `InstancedMesh`, 1 draw call). O número N em
 * `tiles` usa o frame `tile_N` do atlas `atlasUrl` (chave do `parseAtlas`);
 * −1 = vazio. Cada tile mostra só o seu frame (G93); tile sem frame fica
 * invisível. Mesmo `layerId` substitui a camada.
 */
export interface TilemapLayerDescriptor {
  readonly layerId: string;
  readonly atlasUrl: string;
  readonly tileMatrix: TileDataMatrix;
  readonly position?: { readonly x: number; readonly y: number; readonly z: number };
  readonly renderOrder?: number;
}

/**
 * Camada de parallax (G94). `factor` 0 = presa à câmera (infinitamente
 * longe), 1 = anda junto com o mundo. Em eixos com repeat (padrão: X sim,
 * Y não) o quad acompanha a câmera e a rolagem é feita só pelo offset da
 * textura (fundo infinito); sem repeat o quad se move `câmera·(1−factor)`.
 * `width`/`height` em unidades de mundo (padrão 100×50).
 */
export interface ParallaxLayerConfig {
  readonly layerId: string;
  readonly textureUrl: string;
  readonly factorX: number;
  readonly factorY: number;
  readonly depthZ?: number;
  readonly repeatX?: boolean;
  readonly repeatY?: boolean;
  readonly width?: number;
  readonly height?: number;
}

export interface PixelArtCameraConfig {
  readonly designWidth: number;
  readonly designHeight: number;
  readonly pixelRatio?: number;
}

/**
 * Sprite 2D (quad). `atlasUrl` é a CHAVE usada em `parseAtlas`.
 * Tamanho (G94): com `pixelsPerUnit` o quad tem o tamanho do frame original
 * em unidades de mundo (px / pixelsPerUnit); sem ele, altura 1 e largura
 * pela proporção do frame. `scale` multiplica. Frames recortados (`trimmed`)
 * mantêm o pivô no centro do tamanho original; frames girados são
 * desvirados. Frame inexistente deixa o sprite invisível (com aviso).
 */
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
  readonly pixelsPerUnit?: number;
}

/**
 * Animação por frames (G94). Atualizada pela engine no `game.loop.render`
 * com o delta do frame (congela com o jogo pausado). Sem `loop`, para no
 * último frame e emite `game.sprites.animation-ended`.
 */
export interface SpriteAnimationDescriptor {
  readonly name: string;
  readonly frames: ReadonlyArray<string>;
  /** Frames por segundo (> 0). */
  readonly frameRate: number;
  readonly loop?: boolean;
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