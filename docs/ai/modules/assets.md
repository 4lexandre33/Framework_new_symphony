# assets — Asset Pipeline & VRAM Cache
capability: game.assets@1.0.0 | category: functional | engine plugin id: game.assets
use (from src/projects/<jogo>/**):
  import { AssetsToken } from "../../tokens/assets";
  // acesso: const api = ctx.caps.require(Token)  (declare o token em capabilities.consumes + permissions.capabilities)

## token src/tokens/assets.ts
```ts
interface CachedAssetRecord<T = any> {
  readonly data: T;
  readonly type: AssetType;
  refCount: number;
}
interface AssetsApi {
  loadGLTF(url: string): Promise<any>; // Carrega assincronamente um modelo 3D GLTF/GLB e incrementa sua contagem de referências.
  loadTexture(url: string): Promise<any>; // Carrega assincronamente uma textura (PNG, JPG, WebP) para Three.js.
  loadAudio(url: string): Promise<AudioBuffer>; // Carrega e decodifica um arquivo de áudio (WAV, MP3, OGG) via Web Audio API.
  releaseAsset(url: string): void; // Decrementa a contagem de referências de um asset.
  getAsset<T = any>(url: string): T | null; // Recupera um asset previamente carregado do cache sem alterar a contagem de referências.
  clearCache(): void; // Libera todos os assets do cache e esvazia a memória de vídeo (VRAM).
}
capability AssetsToken = "game.assets"@1.0.0 api AssetsApi
```
## contract src/contracts/assets/types.ts
```ts
export type AssetType = "gltf" | "texture" | "audio" | "json" | "binary";
export type AssetLoadState = "unloaded" | "loading" | "loaded" | "error";
interface AssetDescriptor {
  readonly id: string;
  readonly url: string;
  readonly type: AssetType;
  readonly sizeBytes?: number;
}
interface AssetManifest {
  readonly version: string;
  readonly assets: ReadonlyArray<AssetDescriptor>;
}
interface AssetProgressPayload {
  readonly url: string;
  readonly loadedBytes: number;
  readonly totalBytes: number;
  readonly progressPercentage: number;
}
event AssetProgressEvent = "game.assets.progress" payload AssetProgressPayload
interface AssetLoadedPayload {
  readonly id: string;
  readonly url: string;
  readonly type: AssetType;
}
event AssetLoadedEvent = "game.assets.loaded" payload AssetLoadedPayload
```
