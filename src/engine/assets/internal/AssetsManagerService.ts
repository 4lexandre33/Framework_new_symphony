import type {
  GLTF,
} from "three/examples/jsm/loaders/GLTFLoader.js";

import type * as THREE from "three";

import type {
  AssetDescriptor,
  AssetManifest,
  AssetType,
  ManifestLoadFailure,
  ManifestLoadResult,
  ManifestPreloadOptions,
  ManifestProgressPayload,
  TextureLoadOptions,
} from "../../../contracts/assets/types";

import type {
  AssetsApi,
} from "../../../tokens/assets";

import {
  AssetCache,
} from "./AssetCache";

import {
  fetchArrayBuffer,
  normalizeAssetUrl,
  resolveDefaultBaseUrl,
} from "./AssetFetch";

import type {
  AssetProgressCallback,
  FetchLike,
} from "./AssetFetch";

import {
  AudioLoaderService,
} from "./AudioLoaderService";

import {
  GLTFLoaderService,
  instantiateGLTF,
} from "./GLTFLoaderService";

import {
  TextureLoaderService,
} from "./TextureLoaderService";

export interface AssetsEventSink {
  onProgress(url: string, loadedBytes: number, totalBytes: number): void;
  onLoaded(id: string, url: string, type: AssetType): void;
  onLoadFailed?(id: string, url: string, type: AssetType, error: string): void;
  onManifestProgress?(payload: ManifestProgressPayload): void;
}

/**
 * Loaders injetáveis (testes em node, hosts sem DOM). Todos recebem a URL
 * já normalizada; `onProgress` é opcional para quem quiser reportar bytes.
 */
export interface AssetLoaderSet {
  readonly loadGLTF: (url: string, onProgress?: AssetProgressCallback) => Promise<GLTF>;
  readonly loadTexture: (
    url: string,
    options?: TextureLoadOptions,
    onProgress?: AssetProgressCallback,
  ) => Promise<THREE.Texture>;
  readonly loadAudio: (url: string, onProgress?: AssetProgressCallback) => Promise<AudioBuffer>;
  readonly loadJSON?: (url: string, onProgress?: AssetProgressCallback) => Promise<unknown>;
  readonly loadBinary?: (url: string, onProgress?: AssetProgressCallback) => Promise<ArrayBuffer>;
  readonly disposeAudio: () => void;
}

export interface AssetsManagerOptions {
  /** Base para resolver URLs relativas (padrão: document.baseURI/location). */
  readonly baseUrl?: string;
  /** fetch usado pelos loaders padrão (json/binary/áudio/textura). */
  readonly fetch?: FetchLike;
}

const DEFAULT_MANIFEST_CONCURRENCY = 4;
const VALID_TYPES: ReadonlySet<string> = new Set(["gltf", "texture", "audio", "json", "binary"]);

function textureVariant(options: TextureLoadOptions | undefined): string {
  if (options === undefined) {
    return "";
  }

  const colorSpace = options.colorSpace ?? "srgb";
  const flip = options.flipY === undefined ? "" : options.flipY ? ";flipY=1" : ";flipY=0";

  if (colorSpace === "srgb" && flip.length === 0) {
    return "";
  }

  return `#texture:colorSpace=${colorSpace}${flip}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface ManifestTracker {
  readonly version: string;
  readonly total: number;
  readonly perAsset: Map<string, { loaded: number; total: number; size: number }>;
  loadedCount: number;
  failedCount: number;
  lastProgress: number;
  currentUrl: string;
}

export class AssetsManagerService implements AssetsApi {
  private readonly cache = new AssetCache();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly aliases = new Map<string, string>();
  private readonly manifestRetains = new WeakMap<AssetManifest, string[]>();
  private readonly loaders: AssetLoaderSet;
  private readonly loadJSONImpl: (url: string, onProgress?: AssetProgressCallback) => Promise<unknown>;
  private readonly loadBinaryImpl: (url: string, onProgress?: AssetProgressCallback) => Promise<ArrayBuffer>;
  private readonly baseUrl: string;
  private disposed = false;

  public constructor(
    private readonly eventSink?: AssetsEventSink,
    loaders?: Partial<AssetLoaderSet>,
    options?: AssetsManagerOptions,
  ) {
    this.baseUrl = options?.baseUrl ?? resolveDefaultBaseUrl();
    const fetchImpl = options?.fetch;

    const progressObserver = {
      onProgress: (url: string, loadedBytes: number, totalBytes: number): void => {
        this.emitProgress(url, loadedBytes, totalBytes);
      },
    };

    let gltfLoader: GLTFLoaderService | null = null;
    let textureLoader: TextureLoaderService | null = null;
    let audioLoader: AudioLoaderService | null = null;

    // Loaders padrão criados sob demanda: construir o serviço não exige DOM
    // nem Web Audio (G83).
    this.loaders = {
      loadGLTF:
        loaders?.loadGLTF ??
        ((url, onProgress) => {
          gltfLoader ??= new GLTFLoaderService(progressObserver);
          return gltfLoader.load(url, onProgress);
        }),
      loadTexture:
        loaders?.loadTexture ??
        ((url, textureOptions, onProgress) => {
          textureLoader ??= new TextureLoaderService(progressObserver, fetchImpl);
          return textureLoader.load(url, textureOptions, onProgress);
        }),
      loadAudio:
        loaders?.loadAudio ??
        ((url, onProgress) => {
          audioLoader ??= new AudioLoaderService(progressObserver, fetchImpl);
          return audioLoader.load(url, onProgress);
        }),
      disposeAudio: (): void => {
        loaders?.disposeAudio?.();
        audioLoader?.dispose();
        audioLoader = null;
      },
    };

    this.loadJSONImpl =
      loaders?.loadJSON ??
      (async (url, onProgress): Promise<unknown> => {
        const { buffer } = await fetchArrayBuffer(
          url,
          (loaded, total): void => {
            this.emitProgress(url, loaded, total);
            onProgress?.(loaded, total);
          },
          fetchImpl,
        );
        return JSON.parse(new TextDecoder().decode(buffer)) as unknown;
      });

    this.loadBinaryImpl =
      loaders?.loadBinary ??
      (async (url, onProgress): Promise<ArrayBuffer> => {
        const { buffer } = await fetchArrayBuffer(
          url,
          (loaded, total): void => {
            this.emitProgress(url, loaded, total);
            onProgress?.(loaded, total);
          },
          fetchImpl,
        );
        return buffer;
      });
  }

  public normalizeUrl(url: string): string {
    return normalizeAssetUrl(url, this.baseUrl);
  }

  public async loadGLTF(url: string): Promise<GLTF> {
    const template = await this.loadAsset<GLTF>(url, "gltf", undefined, undefined);
    return instantiateGLTF(template);
  }

  public async loadTexture(url: string, options?: TextureLoadOptions): Promise<THREE.Texture> {
    return this.loadAsset<THREE.Texture>(url, "texture", options, undefined);
  }

  public async loadAudio(url: string): Promise<AudioBuffer> {
    return this.loadAsset<AudioBuffer>(url, "audio", undefined, undefined);
  }

  public async loadJSON<T = unknown>(url: string): Promise<T> {
    return this.loadAsset<T>(url, "json", undefined, undefined);
  }

  public async loadBinary(url: string): Promise<ArrayBuffer> {
    return this.loadAsset<ArrayBuffer>(url, "binary", undefined, undefined);
  }

  public retainAsset(url: string, options?: TextureLoadOptions): boolean {
    if (this.disposed) {
      return false;
    }

    const key = this.resolveKey(url, options);
    return key !== null && this.cache.retain(key);
  }

  public releaseAsset(url: string, options?: TextureLoadOptions): void {
    if (this.disposed) {
      return;
    }

    const key = this.resolveKey(url, options);

    if (key === null) {
      return;
    }

    if (this.cache.release(key)) {
      this.dropAliasesFor(key);
    }
  }

  public getAsset<T = unknown>(url: string, options?: TextureLoadOptions): T | null {
    if (this.disposed) {
      return null;
    }

    const key = this.resolveKey(url, options);
    return key === null ? null : this.cache.get<T>(key);
  }

  public getRefCount(url: string, options?: TextureLoadOptions): number {
    const key = this.resolveKey(url, options);
    return key === null ? 0 : this.cache.getRefCount(key);
  }

  public clearCache(options?: { readonly force?: boolean }): number {
    if (this.disposed) {
      return 0;
    }

    if (options?.force === true) {
      const count = this.cache.size;
      this.cache.clear();
      this.aliases.clear();
      return count;
    }

    const freed = this.cache.releaseUnreferenced();
    const retained = this.cache.snapshot();

    if (retained.length > 0) {
      console.warn(
        `[AssetsManagerService] clearCache manteve ${String(retained.length)} asset(s) ainda referenciado(s); use releaseAsset ou clearCache({ force: true }).`,
      );
    }

    return freed;
  }

  public async preloadManifest(
    manifest: AssetManifest,
    options?: ManifestPreloadOptions,
  ): Promise<ManifestLoadResult> {
    if (this.disposed) {
      throw new Error("AssetsManagerService já foi descartado.");
    }

    const descriptors = manifest.assets;

    for (const descriptor of descriptors) {
      if (!VALID_TYPES.has(descriptor.type)) {
        throw new RangeError(`tipo de asset desconhecido no manifesto: ${String(descriptor.type)}`);
      }
    }

    const tracker: ManifestTracker = {
      version: manifest.version,
      total: descriptors.length,
      perAsset: new Map(),
      loadedCount: 0,
      failedCount: 0,
      lastProgress: -1,
      currentUrl: "",
    };

    for (const descriptor of descriptors) {
      const size =
        descriptor.sizeBytes !== undefined && Number.isFinite(descriptor.sizeBytes) && descriptor.sizeBytes > 0
          ? descriptor.sizeBytes
          : 0;
      tracker.perAsset.set(descriptor.id, { loaded: 0, total: size, size });
    }

    const loaded: string[] = [];
    const failed: ManifestLoadFailure[] = [];
    const retainedKeys: string[] = this.manifestRetains.get(manifest) ?? [];
    this.manifestRetains.set(manifest, retainedKeys);
    const concurrency =
      options?.concurrency !== undefined && Number.isInteger(options.concurrency) && options.concurrency > 0
        ? options.concurrency
        : DEFAULT_MANIFEST_CONCURRENCY;
    let cursor = 0;
    let abortError: unknown = null;

    this.emitManifestProgress(tracker, true);

    const worker = async (): Promise<void> => {
      while (cursor < descriptors.length && abortError === null && !this.disposed) {
        const descriptor = descriptors[cursor] as AssetDescriptor;
        cursor += 1;
        tracker.currentUrl = descriptor.url;

        const entry = tracker.perAsset.get(descriptor.id);
        const onProgress: AssetProgressCallback = (loadedBytes, totalBytes): void => {
          if (entry !== undefined) {
            entry.loaded = Number.isFinite(loadedBytes) && loadedBytes > 0 ? loadedBytes : 0;

            if (entry.size === 0 && Number.isFinite(totalBytes) && totalBytes > 0) {
              entry.total = totalBytes;
            }
          }

          this.emitManifestProgress(tracker, false);
        };

        try {
          await this.loadAsset<unknown>(descriptor.url, descriptor.type, undefined, onProgress, descriptor.id);
          const key = this.resolveKey(descriptor.url, undefined);

          if (key !== null) {
            retainedKeys.push(key);
            this.aliases.set(descriptor.id, key);
          }

          if (entry !== undefined && entry.total === 0) {
            entry.total = Math.max(entry.loaded, 1);
          }

          if (entry !== undefined) {
            entry.loaded = entry.total;
          }

          loaded.push(descriptor.id);
          tracker.loadedCount += 1;
        } catch (error: unknown) {
          const message = errorMessage(error);
          failed.push({ id: descriptor.id, url: descriptor.url, type: descriptor.type, error: message });
          tracker.failedCount += 1;
          this.eventSink?.onLoadFailed?.(descriptor.id, descriptor.url, descriptor.type, message);

          if (options?.failFast === true) {
            abortError = error;
          }
        }

        this.emitManifestProgress(tracker, true);
      }
    };

    const workers: Promise<void>[] = [];

    for (let index = 0; index < Math.min(concurrency, descriptors.length); index += 1) {
      workers.push(worker());
    }

    await Promise.all(workers);

    if (abortError !== null) {
      throw abortError instanceof Error ? abortError : new Error(errorMessage(abortError));
    }

    return { loaded, failed };
  }

  public releaseManifest(manifest: AssetManifest): void {
    const keys = this.manifestRetains.get(manifest);

    if (keys === undefined) {
      return;
    }

    this.manifestRetains.delete(manifest);

    for (const key of keys) {
      if (!this.disposed && this.cache.release(key)) {
        this.dropAliasesFor(key);
      }
    }
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.inFlight.clear();
    this.aliases.clear();
    this.cache.clear();
    this.loaders.disposeAudio();
  }

  public getCachedRefCount(url: string): number {
    return this.getRefCount(url);
  }

  public get inFlightCount(): number {
    return this.inFlight.size;
  }

  private resolveKey(urlOrId: string, options: TextureLoadOptions | undefined): string | null {
    if (typeof urlOrId !== "string") {
      return null;
    }

    const trimmed = urlOrId.trim();

    if (trimmed.length === 0) {
      return null;
    }

    const alias = this.aliases.get(trimmed);

    if (alias !== undefined) {
      return alias;
    }

    try {
      return normalizeAssetUrl(trimmed, this.baseUrl) + textureVariant(options);
    } catch {
      return null;
    }
  }

  private dropAliasesFor(key: string): void {
    for (const [id, target] of this.aliases) {
      if (target === key) {
        this.aliases.delete(id);
      }
    }
  }

  private async loadAsset<T>(
    url: string,
    type: AssetType,
    textureOptions: TextureLoadOptions | undefined,
    onProgress: AssetProgressCallback | undefined,
    id?: string,
  ): Promise<T> {
    if (this.disposed) {
      throw new Error("AssetsManagerService já foi descartado.");
    }

    const requestedUrl = typeof url === "string" ? url.trim() : "";
    const normalizedUrl = normalizeAssetUrl(requestedUrl, this.baseUrl);
    const key = normalizedUrl + (type === "texture" ? textureVariant(textureOptions) : "");
    const cached = this.cache.get<T>(key);

    if (cached !== null) {
      this.cache.retain(key);
      return cached;
    }

    const existing = this.inFlight.get(key);

    if (existing !== undefined) {
      const result = (await existing) as T;

      if (this.disposed) {
        throw new Error("AssetsManagerService foi descartado durante o carregamento.");
      }

      this.cache.retain(key);
      return result;
    }

    const promise = this.runLoader(normalizedUrl, type, textureOptions, onProgress);
    this.inFlight.set(key, promise);

    try {
      const result = (await promise) as T;

      if (this.disposed) {
        this.disposeUncachedResult(result, type);
        throw new Error("AssetsManagerService foi descartado durante o carregamento.");
      }

      this.cache.set(key, result, type);
      this.eventSink?.onLoaded(id ?? requestedUrl, requestedUrl, type);
      return result;
    } catch (error: unknown) {
      if (!this.disposed && id === undefined) {
        this.eventSink?.onLoadFailed?.(requestedUrl, requestedUrl, type, errorMessage(error));
      }

      throw error;
    } finally {
      if (this.inFlight.get(key) === promise) {
        this.inFlight.delete(key);
      }
    }
  }

  private runLoader(
    url: string,
    type: AssetType,
    textureOptions: TextureLoadOptions | undefined,
    onProgress: AssetProgressCallback | undefined,
  ): Promise<unknown> {
    switch (type) {
      case "gltf":
        return this.loaders.loadGLTF(url, onProgress);
      case "texture":
        return this.loaders.loadTexture(url, textureOptions, onProgress);
      case "audio":
        return this.loaders.loadAudio(url, onProgress);
      case "json":
        return this.loadJSONImpl(url, onProgress);
      case "binary":
        return this.loadBinaryImpl(url, onProgress);
      default:
        return Promise.reject(new RangeError(`tipo de asset desconhecido: ${String(type)}`));
    }
  }

  private emitManifestProgress(tracker: ManifestTracker, force: boolean): void {
    const sink = this.eventSink?.onManifestProgress;

    if (sink === undefined || this.disposed) {
      return;
    }

    let loadedBytes = 0;
    let totalBytes = 0;
    let allSized = true;
    let fractional = 0;

    for (const entry of tracker.perAsset.values()) {
      loadedBytes += entry.loaded;
      totalBytes += entry.total;

      if (entry.total <= 0) {
        allSized = false;
      } else {
        fractional += Math.min(1, entry.loaded / entry.total);
      }
    }

    const done = tracker.loadedCount + tracker.failedCount;
    let progress: number;

    if (tracker.total === 0) {
      progress = 1;
    } else if (allSized && totalBytes > 0) {
      progress = Math.min(1, loadedBytes / totalBytes);
    } else {
      progress = Math.min(1, Math.max(done, fractional) / tracker.total);
    }

    if (done === tracker.total) {
      // Falhas contam como concluídas: a barra termina em 100%.
      progress = 1;
    }

    if (!force && progress - tracker.lastProgress < 0.005) {
      return;
    }

    tracker.lastProgress = progress;
    sink.call(this.eventSink, {
      manifestVersion: tracker.version,
      loadedCount: tracker.loadedCount,
      failedCount: tracker.failedCount,
      totalCount: tracker.total,
      loadedBytes,
      totalBytes: allSized ? totalBytes : 0,
      progress,
      currentUrl: tracker.currentUrl,
    });
  }

  private emitProgress(url: string, loadedBytes: number, totalBytes: number): void {
    if (this.disposed) {
      return;
    }

    const safeLoaded = Number.isFinite(loadedBytes) && loadedBytes > 0 ? loadedBytes : 0;
    const safeTotal = Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : 0;
    this.eventSink?.onProgress(url, safeLoaded, safeTotal);
  }

  private disposeUncachedResult(result: unknown, type: AssetType): void {
    const temporaryCache = new AssetCache();
    temporaryCache.set("__dispose__", result, type);
    temporaryCache.release("__dispose__");
  }
}
