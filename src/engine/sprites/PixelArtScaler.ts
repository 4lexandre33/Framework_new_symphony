import * as THREE from "three";

export class PixelArtScaler {
  public static calculateIntegerScale(
    viewportWidth: number,
    viewportHeight: number,
    designWidth: number,
    designHeight: number
  ): number {
    const scaleX = Math.floor(viewportWidth / designWidth);
    const scaleY = Math.floor(viewportHeight / designHeight);
    const scale = Math.max(1, Math.min(scaleX, scaleY));
    return scale;
  }

  public static applyPixelPerfectZoom(
    camera: THREE.OrthographicCamera,
    viewportWidth: number,
    viewportHeight: number,
    designWidth: number,
    designHeight: number
  ): number {
    const integerScale = this.calculateIntegerScale(
      viewportWidth,
      viewportHeight,
      designWidth,
      designHeight
    );

    const halfW = viewportWidth / (2 * integerScale);
    const halfH = viewportHeight / (2 * integerScale);

    camera.left = -halfW;
    camera.right = halfW;
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.updateProjectionMatrix();

    return integerScale;
  }
}