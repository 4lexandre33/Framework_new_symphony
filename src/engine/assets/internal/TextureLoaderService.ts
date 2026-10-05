import * as THREE from "three";

import type {
  AssetLoadProgressObserver,
} from "./GLTFLoaderService";

export class TextureLoaderService {
  private readonly loader =
    new THREE.TextureLoader();

  public constructor(
    private readonly observer?:
      AssetLoadProgressObserver,
  ) {}

  public async load(
    url:
      string,
  ): Promise<THREE.Texture> {
    return new Promise<
      THREE.Texture
    >(
      (
        resolve,
        reject,
      ): void => {
        this.loader.load(
          url,
          (
            texture,
          ): void => {
            texture.colorSpace =
              THREE.SRGBColorSpace;

            resolve(
              texture,
            );
          },
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
