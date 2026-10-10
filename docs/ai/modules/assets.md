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
interface AssetsApi { // Cache de assets com contagem de referências.
  loadGLTF(url: string): Promise<any>; // Carrega um GLTF/GLB e devolve uma INSTÂNCIA independente: `scene` é um clone (SkeletonUtils) do modelo em cac…
  loadTexture(url: string, options?: TextureLoadOptions): Promise<any>; // Carrega uma textura (PNG, JPG, WebP) com progresso real.
  loadAudio(url: string): Promise<AudioBuffer>; // Carrega e decodifica áudio.
  loadJSON<T = unknown>(url: string): Promise<T>; // Carrega e faz parse de JSON (cacheado e com refcount como os demais).
  loadBinary(url: string): Promise<ArrayBuffer>; // Carrega bytes crus (cacheado e com refcount).
  preloadManifest(manifest: AssetManifest, options?: ManifestPreloadOptions): Promise<ManifestLoadResult>; // Pré-carrega um manifesto com progresso agregado real (`game.assets.manifest-progress`).
  releaseManifest(manifest: AssetManifest): void; // Libera uma vez cada asset que `preloadManifest` carregou deste manifesto.
  retainAsset(url: string, options?: TextureLoadOptions): boolean; // Retém +1 um asset já em cache (false se não está em cache).
  releaseAsset(url: string, options?: TextureLoadOptions): void; // Decrementa a contagem de referências de um asset.
  getAsset<T = any>(url: string, options?: TextureLoadOptions): T | null; // Recupera um asset previamente carregado do cache (por URL ou id de manifesto) sem alterar a contagem de refer…
  getRefCount(url: string, options?: TextureLoadOptions): number; // Contagem de referências atual (0 se não está em cache).
  normalizeUrl(url: string): string; // URL canônica usada como chave de cache.
  clearCache(options?: { readonly force?: boolean }): number; // Libera do cache só o que não tem referências vivas e devolve quantos itens foram liberados.
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
export type TextureColorSpace = "srgb" | "linear" | "none"; // Espaço de cor de uma textura: "srgb" (cor/albedo, padrão), "linear" ou "none" (normal, roughness, dados).
interface TextureLoadOptions {
  readonly colorSpace?: TextureColorSpace;
  readonly flipY?: boolean;
}
interface ManifestPreloadOptions {
  readonly concurrency?: number; // Downloads simultâneos (padrão 4).
  readonly failFast?: boolean; // Rejeita no primeiro erro (padrão false: segue e lista em `failed`).
}
interface ManifestLoadFailure {
  readonly id: string;
  readonly url: string;
  readonly type: AssetType;
  readonly error: string;
}
interface ManifestLoadResult {
  readonly loaded: readonly string[]; // ids carregados (e retidos uma vez cada; libere com `releaseManifest`).
  readonly failed: readonly ManifestLoadFailure[];
}
interface ManifestProgressPayload {
  readonly manifestVersion: string;
  readonly loadedCount: number;
  readonly failedCount: number;
  readonly totalCount: number;
  readonly loadedBytes: number;
  readonly totalBytes: number; // 0 enquanto desconhecido (sem `sizeBytes` nem content-length).
  readonly progress: number; // 0..1, por bytes quando conhecidos, senão por contagem com frações parciais.
  readonly currentUrl: string;
}
event ManifestProgressEvent = "game.assets.manifest-progress" payload ManifestProgressPayload
interface AssetLoadFailedPayload {
  readonly id: string;
  readonly url: string;
  readonly type: AssetType;
  readonly error: string;
}
event AssetLoadFailedEvent = "game.assets.load-failed" payload AssetLoadFailedPayload
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
