# sprites — Motor 2D, Tilemaps & Pixel Art
capability: game.sprites@1.0.0 | category: functional | engine plugin id: game.sprites
dependsOn: game.render, game.assets
consumes: RenderToken, AssetsToken
use (from src/projects/<jogo>/**):
  import { SpritesToken } from "../../tokens/sprites";
  // acesso: const api = ctx.caps.require(Token)  (declare o token em capabilities.consumes + permissions.capabilities)

## token src/tokens/sprites.ts
```ts
interface SpritesApi { // Sprites 2D, tilemaps e parallax.
  parseAtlas(atlasKey: string, json: TextureAtlasJSON, texture: THREE.Texture): void;
  getFrameUV(atlasKey: string, frameName: string): UVRect | null;
  getAtlasTexture(atlasKey: string): THREE.Texture | null; // Clone próprio da textura do atlas (não descarte), ou null.
  renderTilemap(descriptor: TilemapLayerDescriptor): THREE.InstancedMesh; // Cria/substitui uma camada de tilemap (1 draw call; G93).
  removeTilemap(layerId: string): boolean;
  createParallaxBackground(layers: ReadonlyArray<ParallaxLayerConfig>): void; // Cria/substitui camadas de parallax.
  removeParallaxLayer(layerId: string): boolean;
  setParallaxSpeed(layerId: string, factorX: number, factorY: number): boolean;
  updateParallax(cameraX: number, cameraY: number): void; // Posiciona as camadas para a câmera em (x, y).
  spawnSprite2D(options: Sprite2DOptions): THREE.Mesh;
  despawnSprite2D(spriteId: string): boolean;
  getSprite(spriteId: string): THREE.Mesh | null; // Malha do sprite (mova/gire à vontade; não descarte), ou null.
  setSpriteFrame(spriteId: string, frameName: string): boolean; // Mostra um frame fixo (interrompe a animação).
  playSpriteAnimation(spriteId: string, animation: SpriteAnimationDescriptor): boolean; // Toca uma animação por frames (G94).
  stopSpriteAnimation(spriteId: string): boolean;
  setPixelPerfectScaling( camera: THREE.OrthographicCamera, viewportWidth: number, viewportHeight: number, designWidth: number, designHeight: number ): number;
  update(deltaSeconds: number): void; // Avança animações.
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
interface UVRect { // Retângulo do frame no atlas em UV (origem embaixo à esquerda).
  readonly u: number;
  readonly v: number;
  readonly w: number;
  readonly h: number;
  readonly rotated?: boolean;
}
interface TileDataMatrix {
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  readonly tiles: ReadonlyArray<number>;
}
interface TilemapLayerDescriptor { // Camada de tilemap (uma `InstancedMesh`, 1 draw call).
  readonly layerId: string;
  readonly atlasUrl: string;
  readonly tileMatrix: TileDataMatrix;
  readonly position?: { readonly x: number; readonly y: number; readonly z: number };
  readonly renderOrder?: number;
}
interface ParallaxLayerConfig { // Camada de parallax (G94).
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
interface PixelArtCameraConfig {
  readonly designWidth: number;
  readonly designHeight: number;
  readonly pixelRatio?: number;
}
interface Sprite2DOptions { // Sprite 2D (quad).
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
interface SpriteAnimationDescriptor { // Animação por frames (G94).
  readonly name: string;
  readonly frames: ReadonlyArray<string>;
  readonly frameRate: number; // Frames por segundo (> 0).
  readonly loop?: boolean;
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
## notas verificadas (comportamento)
- BUG GRAVE (G92): o plugin não declara acesso ao render/assets. `spawnSprite2D`, `despawnSprite2D`, `renderTilemap`, `createParallaxBackground`, `clear`, `dispose` e os comandos LANÇAM erro. Funcionam só `parseAtlas`, `getFrameUV`, `updateParallax`, `setPixelPerfectScaling`.
- BUG (G93): mesmo corrigido o acesso, o shader do tilemap mostraria o atlas inteiro em cada tile.
- Uso recomendado hoje: `await assets.loadTexture(url)` → `parseAtlas(url, json, texture)` → `getFrameUV(url, nome)` para obter UVs; desenhe sprites/tilemaps com malhas do PRÓPRIO jogo (`PlaneGeometry`/`InstancedMesh` + `MeshBasicMaterial`, `addMeshToScene`).
- Convenção do tilemap da engine (para quando for corrigido): o número N em `tiles` usa o frame `tile_N`; −1 = vazio; mesmo `layerId` substitui.
