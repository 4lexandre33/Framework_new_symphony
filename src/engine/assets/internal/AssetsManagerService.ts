import type {
  GLTF,
} from "three/examples/jsm/loaders/GLTFLoader.js";

import type * as THREE from "three";

import type {
  AssetType,
} from "../../../contracts/assets/types";

import type {
  AssetsApi,
} from "../../../tokens/assets";

import {
  AssetCache,
} from "./AssetCache";

import {
  AudioLoaderService,
} from "./AudioLoaderService";

import {
  GLTFLoaderService,
} from "./GLTFLoaderService";

import {
  TextureLoaderService,
} from "./TextureLoaderService";

export interface AssetsEventSink {
  onProgress(
    url:
      string,
    loadedBytes:
      number,
    totalBytes:
      number,
  ): void;

  onLoaded(
    id:
      string,
    url:
      string,
    type:
      AssetType,
  ): void;
}

export interface AssetLoaderSet {
  readonly loadGLTF:
    (
      url:
        string,
    ) => Promise<GLTF>;

  readonly loadTexture:
    (
      url:
        string,
    ) => Promise<THREE.Texture>;

  readonly loadAudio:
    (
      url:
        string,
    ) => Promise<AudioBuffer>;

  readonly disposeAudio:
    () => void;
}

function normalizeUrl(
  url:
    string,
): string {
  const normalized =
    url.trim();

  if (
    normalized.length ===
    0
  ) {
    throw new RangeError(
      "URL de asset não pode ser vazia.",
    );
  }

  return normalized;
}

export class AssetsManagerService
  implements AssetsApi {
  private readonly cache =
    new AssetCache();

  private readonly inFlight =
    new Map<
      string,
      Promise<unknown>
    >();

  private readonly loaders:
    AssetLoaderSet;

  private disposed =
    false;

  public constructor(
    private readonly eventSink?:
      AssetsEventSink,
    loaders?:
      AssetLoaderSet,
  ) {
    if (
      loaders !==
      undefined
    ) {
      this.loaders =
        loaders;

      return;
    }

    const progressObserver = {
      onProgress:
        (
          url:
            string,
          loadedBytes:
            number,
          totalBytes:
            number,
        ): void => {
          this.emitProgress(
            url,
            loadedBytes,
            totalBytes,
          );
        },
    };

    const gltfLoader =
      new GLTFLoaderService(
        progressObserver,
      );

    const textureLoader =
      new TextureLoaderService(
        progressObserver,
      );

    const audioLoader =
      new AudioLoaderService(
        progressObserver,
      );

    this.loaders = {
      loadGLTF:
        (
          url,
        ) =>
          gltfLoader.load(
            url,
          ),

      loadTexture:
        (
          url,
        ) =>
          textureLoader.load(
            url,
          ),

      loadAudio:
        (
          url,
        ) =>
          audioLoader.load(
            url,
          ),

      disposeAudio:
        (): void => {
          audioLoader.dispose();
        },
    };
  }

  public async loadGLTF(
    url:
      string,
  ): Promise<GLTF> {
    return this.loadAsset(
      url,
      "gltf",
      this.loaders
        .loadGLTF,
    );
  }

  public async loadTexture(
    url:
      string,
  ): Promise<THREE.Texture> {
    return this.loadAsset(
      url,
      "texture",
      this.loaders
        .loadTexture,
    );
  }

  public async loadAudio(
    url:
      string,
  ): Promise<AudioBuffer> {
    return this.loadAsset(
      url,
      "audio",
      this.loaders
        .loadAudio,
    );
  }

  public releaseAsset(
    url:
      string,
  ): void {
    if (
      this.disposed
    ) {
      return;
    }

    this.cache.release(
      url.trim(),
    );
  }

  public getAsset<T = unknown>(
    url:
      string,
  ): T |
    null {
    if (
      this.disposed
    ) {
      return null;
    }

    return this.cache.get<T>(
      url.trim(),
    );
  }

  public clearCache(): void {
    if (
      this.disposed
    ) {
      return;
    }

    this.cache.clear();
  }

  public dispose(): void {
    if (
      this.disposed
    ) {
      return;
    }

    this.disposed =
      true;

    this.inFlight.clear();
    this.cache.clear();
    this.loaders
      .disposeAudio();
  }

  public getCachedRefCount(
    url:
      string,
  ): number {
    return this.cache
      .getRefCount(
        url.trim(),
      );
  }

  public get inFlightCount():
    number {
    return this.inFlight
      .size;
  }

  private async loadAsset<T>(
    url:
      string,
    type:
      AssetType,
    loader:
      (
        normalizedUrl:
          string,
      ) => Promise<T>,
  ): Promise<T> {
    if (
      this.disposed
    ) {
      throw new Error(
        "AssetsManagerService já foi descartado.",
      );
    }

    const normalizedUrl =
      normalizeUrl(
        url,
      );

    const cached =
      this.cache.get<T>(
        normalizedUrl,
      );

    if (
      cached !==
      null
    ) {
      this.cache.retain(
        normalizedUrl,
      );

      return cached;
    }

    const existing =
      this.inFlight.get(
        normalizedUrl,
      );

    if (
      existing !==
      undefined
    ) {
      const result =
        await existing as
          T;

      if (
        this.disposed
      ) {
        throw new Error(
          "AssetsManagerService foi descartado durante o carregamento.",
        );
      }

      this.cache.retain(
        normalizedUrl,
      );

      return result;
    }

    const promise =
      loader(
        normalizedUrl,
      );

    this.inFlight.set(
      normalizedUrl,
      promise,
    );

    try {
      const result =
        await promise;

      if (
        this.disposed
      ) {
        this.disposeUncachedResult(
          result,
          type,
        );

        throw new Error(
          "AssetsManagerService foi descartado durante o carregamento.",
        );
      }

      this.cache.set(
        normalizedUrl,
        result,
        type,
      );

      this.eventSink
        ?.onLoaded(
          normalizedUrl,
          normalizedUrl,
          type,
        );

      return result;
    } finally {
      if (
        this.inFlight.get(
          normalizedUrl,
        ) ===
        promise
      ) {
        this.inFlight.delete(
          normalizedUrl,
        );
      }
    }
  }

  private emitProgress(
    url:
      string,
    loadedBytes:
      number,
    totalBytes:
      number,
  ): void {
    if (
      this.disposed
    ) {
      return;
    }

    const safeLoaded =
      Number.isFinite(
        loadedBytes,
      ) &&
      loadedBytes >
        0
        ? loadedBytes
        : 0;

    const safeTotal =
      Number.isFinite(
        totalBytes,
      ) &&
      totalBytes >
        0
        ? totalBytes
        : 0;

    this.eventSink
      ?.onProgress(
        url,
        safeLoaded,
        safeTotal,
      );
  }

  private disposeUncachedResult(
    result:
      unknown,
    type:
      AssetType,
  ): void {
    const temporaryCache =
      new AssetCache();

    temporaryCache.set(
      "__dispose__",
      result,
      type,
    );

    temporaryCache.release(
      "__dispose__",
    );
  }
}
