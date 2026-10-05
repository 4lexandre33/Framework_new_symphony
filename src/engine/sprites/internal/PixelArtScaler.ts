import * as THREE from "three";

function positiveFiniteOr(
  value:
    number,
  fallback:
    number,
): number {
  return (
    Number.isFinite(
      value,
    ) &&
    value >
      0
  )
    ? value
    : fallback;
}

export class PixelArtScaler {
  public static calculateIntegerScale(
    viewportWidth:
      number,
    viewportHeight:
      number,
    designWidth:
      number,
    designHeight:
      number,
  ): number {
    const safeDesignWidth =
      positiveFiniteOr(
        designWidth,
        1,
      );

    const safeDesignHeight =
      positiveFiniteOr(
        designHeight,
        1,
      );

    const safeViewportWidth =
      positiveFiniteOr(
        viewportWidth,
        safeDesignWidth,
      );

    const safeViewportHeight =
      positiveFiniteOr(
        viewportHeight,
        safeDesignHeight,
      );

    const scaleX =
      Math.floor(
        safeViewportWidth /
        safeDesignWidth,
      );

    const scaleY =
      Math.floor(
        safeViewportHeight /
        safeDesignHeight,
      );

    return Math.max(
      1,
      Math.min(
        scaleX,
        scaleY,
      ),
    );
  }

  public static applyPixelPerfectZoom(
    camera:
      THREE.OrthographicCamera,
    viewportWidth:
      number,
    viewportHeight:
      number,
    designWidth:
      number,
    designHeight:
      number,
  ): number {
    const safeDesignWidth =
      positiveFiniteOr(
        designWidth,
        1,
      );

    const safeDesignHeight =
      positiveFiniteOr(
        designHeight,
        1,
      );

    const safeViewportWidth =
      positiveFiniteOr(
        viewportWidth,
        safeDesignWidth,
      );

    const safeViewportHeight =
      positiveFiniteOr(
        viewportHeight,
        safeDesignHeight,
      );

    const integerScale =
      this.calculateIntegerScale(
        safeViewportWidth,
        safeViewportHeight,
        safeDesignWidth,
        safeDesignHeight,
      );

    const halfWidth =
      safeViewportWidth /
      (
        2 *
        integerScale
      );

    const halfHeight =
      safeViewportHeight /
      (
        2 *
        integerScale
      );

    camera.left =
      -halfWidth;

    camera.right =
      halfWidth;

    camera.top =
      halfHeight;

    camera.bottom =
      -halfHeight;

    camera.updateProjectionMatrix();

    return integerScale;
  }
}
