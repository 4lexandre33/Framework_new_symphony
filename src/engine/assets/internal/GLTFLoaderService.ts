import {
  GLTFLoader,
} from "three/examples/jsm/loaders/GLTFLoader.js";

import type {
  GLTF,
} from "three/examples/jsm/loaders/GLTFLoader.js";

export interface AssetLoadProgressObserver {
  onProgress(
    url:
      string,
    loadedBytes:
      number,
    totalBytes:
      number,
  ): void;
}

export class GLTFLoaderService {
  private readonly loader =
    new GLTFLoader();

  public constructor(
    private readonly observer?:
      AssetLoadProgressObserver,
  ) {}

  public async load(
    url:
      string,
  ): Promise<GLTF> {
    return new Promise<
      GLTF
    >(
      (
        resolve,
        reject,
      ): void => {
        this.loader.load(
          url,
          resolve,
          (
            progress,
          ): void => {
            this.observer
              ?.onProgress(
                url,
                progress.loaded,
                progress.total,
              );
          },
          reject,
        );
      },
    );
  }
}
