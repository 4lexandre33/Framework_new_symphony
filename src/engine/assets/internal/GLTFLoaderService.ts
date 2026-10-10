import {
  GLTFLoader,
} from "three/examples/jsm/loaders/GLTFLoader.js";

import type {
  GLTF,
} from "three/examples/jsm/loaders/GLTFLoader.js";

import {
  clone as cloneSkinnedHierarchy,
} from "three/examples/jsm/utils/SkeletonUtils.js";

import type * as THREE from "three";

import type {
  AssetProgressCallback,
} from "./AssetFetch";

export interface AssetLoadProgressObserver {
  onProgress(url: string, loadedBytes: number, totalBytes: number): void;
}

/** Carrega GLTF/GLB com progresso de bytes do FileLoader do Three. */
export class GLTFLoaderService {
  private loader: GLTFLoader | null = null;

  public constructor(private readonly observer?: AssetLoadProgressObserver) {}

  public async load(url: string, onProgress?: AssetProgressCallback): Promise<GLTF> {
    if (this.loader === null) {
      this.loader = new GLTFLoader();
    }

    const loader = this.loader;

    return new Promise<GLTF>((resolve, reject): void => {
      loader.load(
        url,
        (gltf): void => {
          resolve(gltf);
        },
        (progress): void => {
          this.observer?.onProgress(url, progress.loaded, progress.total);
          onProgress?.(progress.loaded, progress.total);
        },
        reject,
      );
    });
  }
}

interface CloneableScene {
  clone(recursive?: boolean): unknown;
}

function isCloneable(value: unknown): value is CloneableScene {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { clone?: unknown }).clone === "function"
  );
}

function cloneScene(scene: CloneableScene): unknown {
  // SkeletonUtils.clone religa ossos/skins; para cenas sem skin equivale a clone(true).
  try {
    return cloneSkinnedHierarchy(scene as unknown as THREE.Object3D);
  } catch {
    return scene.clone(true);
  }
}

/**
 * Instância independente de um GLTF em cache (G79): `scene`/`scenes` são
 * clones (geometria, materiais e texturas compartilhados com o modelo em
 * cache); `animations`, `parser`, `asset` e `userData` são compartilhados.
 */
export function instantiateGLTF<T>(template: T): T {
  if (template === null || typeof template !== "object") {
    return template;
  }

  const source = template as unknown as {
    scene?: unknown;
    scenes?: unknown;
  };

  if (!isCloneable(source.scene)) {
    return template;
  }

  const originalScene = source.scene;
  const scene = cloneScene(originalScene);
  let scenes: unknown = source.scenes;

  if (Array.isArray(source.scenes)) {
    scenes = source.scenes.map((entry: unknown): unknown =>
      entry === originalScene ? scene : isCloneable(entry) ? cloneScene(entry) : entry,
    );
  }

  return {
    ...(template as unknown as Record<string, unknown>),
    scene,
    scenes,
  } as unknown as T;
}
