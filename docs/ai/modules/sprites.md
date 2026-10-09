# sprites — Motor 2D, Tilemaps & Pixel Art
capability: game.sprites@1.0.0 | category: functional | engine plugin id: game.sprites
use (from src/projects/<jogo>/**):
  import { SpritesToken } from "../../tokens/sprites";
  // acesso: const api = ctx.caps.require(Token)  (declare o token em capabilities.consumes + permissions.capabilities)

## token src/tokens/sprites.ts
```ts
interface SpritesApi {
  parseAtlas(atlasKey: string, json: TextureAtlasJSON, texture: THREE.Texture): void;
  getFrameUV(atlasKey: string, frameName: string): UVRect | null;
  renderTilemap(descriptor: TilemapLayerDescriptor): THREE.InstancedMesh;
  createParallaxBackground(layers: ReadonlyArray<ParallaxLayerConfig>): void;
  updateParallax(cameraX: number, cameraY: number): void;
  spawnSprite2D(options: Sprite2DOptions): THREE.Mesh;
  despawnSprite2D(spriteId: string): boolean;
  setPixelPerfectScaling( camera: THREE.OrthographicCamera, viewportWidth: number, viewportHeight: number, designWidth: number, designHeight: number ): number;
  clear(): void;
}
capability SpritesToken = "game.sprites"@1.0.0 api SpritesApi
```
## contract src/contracts/sprites/types.ts
```ts
interface AtlasFrameBounds {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}
interface AtlasFrameData {
  readonly filename: string;
  readonly frame: AtlasFrameBounds;
  readonly rotated: boolean;
  readonly trimmed: boolean;
  readonly spriteSourceSize: AtlasFrameBounds;
  readonly sourceSize: { readonly w: number; readonly h: number };
}
interface TextureAtlasJSON {
  readonly frames: Record<string, AtlasFrameData> | ReadonlyArray<AtlasFrameData>;
  readonly meta: { readonly image: string; readonly size: { readonly w: number; readonly h: number }; readonly scale: string; };
}
interface UVRect {
  readonly u: number;
  readonly v: number;
  readonly w: number;
  readonly h: number;
}
interface TileDataMatrix {
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  readonly tiles: ReadonlyArray<number>;
}
interface TilemapLayerDescriptor {
  readonly layerId: string;
  readonly atlasUrl: string;
  readonly tileMatrix: TileDataMatrix;
  readonly position?: { readonly x: number; readonly y: number; readonly z: number };
  readonly renderOrder?: number;
}
interface ParallaxLayerConfig {
  readonly layerId: string;
  readonly textureUrl: string;
  readonly factorX: number;
  readonly factorY: number;
  readonly depthZ?: number;
  readonly repeatX?: boolean;
  readonly repeatY?: boolean;
}
interface PixelArtCameraConfig {
  readonly designWidth: number;
  readonly designHeight: number;
  readonly pixelRatio?: number;
}
interface Sprite2DOptions {
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
interface TilemapLoadedPayload {
  readonly layerId: string;
  readonly totalTiles: number;
  readonly drawCallCount: number;
}
event TilemapLoadedEvent = "game.sprites.tilemap-loaded" payload TilemapLoadedPayload
interface SpriteAnimationEndedPayload {
  readonly spriteId: string;
  readonly animationName: string;
}
event SpriteAnimationEndedEvent = "game.sprites.animation-ended" payload SpriteAnimationEndedPayload
interface ParallaxScrolledPayload {
  readonly cameraPosition: { readonly x: number; readonly y: number };
}
event ParallaxScrolledEvent = "game.sprites.parallax-scrolled" payload ParallaxScrolledPayload
interface LoadTilemapRequest {
  readonly descriptor: TilemapLayerDescriptor;
}
command LoadTilemapCommand = "game.sprites.load-tilemap" request LoadTilemapRequest
interface SpawnSprite2DRequest {
  readonly options: Sprite2DOptions;
}
command SpawnSprite2DCommand = "game.sprites.spawn-sprite" request SpawnSprite2DRequest
interface SetParallaxSpeedRequest {
  readonly layerId: string;
  readonly factorX: number;
  readonly factorY: number;
}
command SetParallaxSpeedCommand = "game.sprites.set-parallax-speed" request SetParallaxSpeedRequest
```
