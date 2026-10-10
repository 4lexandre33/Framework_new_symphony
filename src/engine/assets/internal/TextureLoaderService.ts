import * as THREE from "three";

import type {
  TextureColorSpace,
  TextureLoadOptions,
} from "../../../contracts/assets/types";

import {
  fetchArrayBuffer,
} from "./AssetFetch";

import type {
  AssetProgressCallback,
  FetchLike,
} from "./AssetFetch";

import type {
  AssetLoadProgressObserver,
} from "./GLTFLoaderService";

export function resolveColorSpace(value: TextureColorSpace | undefined): THREE.ColorSpace {
  switch (value) {
    case "linear":
      return THREE.LinearSRGBColorSpace;
    case "none":
      return THREE.NoColorSpace;
    default:
      return THREE.SRGBColorSpace;
  }
}

/**
 * Texturas com progresso real (fetch em stream → Blob → TextureLoader) e
 * `colorSpace` configurável (G83): "srgb" para cor/albedo (padrão),
 * "linear"/"none" para normal/roughness/metalness/AO/dados.
 */
export class TextureLoaderService {
  private loader: THREE.TextureLoader | null = null;

  public constructor(
    private readonly observer?: AssetLoadProgressObserver,
    private readonly fetchImpl?: (input: string) => Promise<Response>,
  ) {}

  public async load(
    url: string,
    options?: TextureLoadOptions,
    onProgress?: AssetProgressCallback,
  ): Promise<THREE.Texture> {
    const report = (loaded: number, total: number): void => {
      this.observer?.onProgress(url, loaded, total);
      onProgress?.(loaded, total);
    };

    let sourceUrl = url;
    let objectUrl: string | null = null;

    const canUseBlobUrl =
      typeof URL !== "undefined" &&
      typeof URL.createObjectURL === "function" &&
      typeof Blob !== "undefined" &&
      (this.fetchImpl !== undefined || typeof fetch === "function");

    if (canUseBlobUrl) {
      const { buffer, contentType } = await fetchArrayBuffer(url, report, this.fetchImpl as FetchLike | undefined);
      objectUrl = URL.createObjectURL(
        new Blob([buffer], contentType.length > 0 ? { type: contentType } : undefined),
      );
      sourceUrl = objectUrl;
    }

    if (this.loader === null) {
      this.loader = new THREE.TextureLoader();
    }

    const loader = this.loader;

    try {
      const texture = await new Promise<THREE.Texture>((resolve, reject): void => {
        loader.load(sourceUrl, resolve, undefined, reject);
      });

      texture.colorSpace = resolveColorSpace(options?.colorSpace);

      if (options?.flipY !== undefined) {
        texture.flipY = options.flipY;
      }

      texture.name = url;
      texture.needsUpdate = true;

      if (objectUrl === null) {
        report(1, 1);
      }

      return texture;
    } finally {
      if (objectUrl !== null) {
        URL.revokeObjectURL(objectUrl);
      }
    }
  }
}
