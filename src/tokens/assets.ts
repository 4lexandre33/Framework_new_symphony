import { defineCapability } from "@core";
import type {
  AssetManifest,
  AssetType,
  ManifestLoadResult,
  ManifestPreloadOptions,
  TextureLoadOptions,
} from "../contracts/assets/types";

export interface CachedAssetRecord<T = any> {
  readonly data: T;
  readonly type: AssetType;
  refCount: number;
}

/**
 * Cache de assets com contagem de referências. Cada `load*`/`retainAsset`
 * bem-sucedido deve ser pareado com um `releaseAsset`. URLs são
 * normalizadas (`./a.png`, `a.png` e `/a.png` na raiz são o mesmo asset).
 */
export interface AssetsApi {
  /**
   * Carrega um GLTF/GLB e devolve uma INSTÂNCIA independente: `scene` é um
   * clone (SkeletonUtils) do modelo em cache, que compartilha geometria,
   * materiais e texturas. Cada chamada retém +1; chame `releaseAsset(url)`
   * por instância. `getAsset(url)` devolve o modelo-base (não adicione à cena).
   */
  loadGLTF(url: string): Promise<any>;

  /**
   * Carrega uma textura (PNG, JPG, WebP) com progresso real. `colorSpace`
   * padrão "srgb"; use "linear"/"none" para mapas que não são cor. Cada
   * combinação de opções é um asset distinto: passe as mesmas opções a
   * `releaseAsset`/`getAsset`.
   */
  loadTexture(url: string, options?: TextureLoadOptions): Promise<any>;

  /**
   * Carrega e decodifica áudio. Não espera o desbloqueio do áudio: conclui
   * antes do primeiro gesto do usuário. Sem Web Audio, rejeita (não trava).
   */
  loadAudio(url: string): Promise<AudioBuffer>;

  /** Carrega e faz parse de JSON (cacheado e com refcount como os demais). */
  loadJSON<T = unknown>(url: string): Promise<T>;

  /** Carrega bytes crus (cacheado e com refcount). */
  loadBinary(url: string): Promise<ArrayBuffer>;

  /**
   * Pré-carrega um manifesto com progresso agregado real
   * (`game.assets.manifest-progress`). Cada asset carregado é retido uma vez
   * e fica acessível também pelo `id` (`getAsset(id)`). Falhas não rejeitam
   * (salvo `failFast`) e saem em `failed` e em `game.assets.load-failed`.
   */
  preloadManifest(manifest: AssetManifest, options?: ManifestPreloadOptions): Promise<ManifestLoadResult>;

  /** Libera uma vez cada asset que `preloadManifest` carregou deste manifesto. */
  releaseManifest(manifest: AssetManifest): void;

  /** Retém +1 um asset já em cache (false se não está em cache). */
  retainAsset(url: string, options?: TextureLoadOptions): boolean;

  /**
   * Decrementa a contagem de referências de um asset. Se a contagem atingir zero, a VRAM e a memória RAM são liberadas.
   * Liberar mais vezes do que reteve não tem efeito (nunca fica negativo).
   */
  releaseAsset(url: string, options?: TextureLoadOptions): void;

  /**
   * Recupera um asset previamente carregado do cache (por URL ou id de manifesto) sem alterar a contagem de referências.
   */
  getAsset<T = any>(url: string, options?: TextureLoadOptions): T | null;

  /** Contagem de referências atual (0 se não está em cache). */
  getRefCount(url: string, options?: TextureLoadOptions): number;

  /** URL canônica usada como chave de cache. */
  normalizeUrl(url: string): string;

  /**
   * Libera do cache só o que não tem referências vivas e devolve quantos
   * itens foram liberados. Itens retidos são mantidos (com aviso).
   * `{ force: true }` libera TUDO, ignorando refcount (uso em teardown).
   */
  clearCache(options?: { readonly force?: boolean }): number;
}

export const AssetsToken = defineCapability<AssetsApi>("game.assets", "1.0.0");
