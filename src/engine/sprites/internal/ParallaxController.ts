import * as THREE from "three";

import type {
  ParallaxLayerConfig,
} from "../../../contracts/sprites/types";

interface ActiveParallaxLayer {
  readonly config:
    ParallaxLayerConfig;

  readonly mesh:
    THREE.Mesh;

  readonly initialPosition:
    THREE.Vector3;

  factorX:
    number;

  factorY:
    number;
}

function finiteOrZero(
  value:
    number,
): number {
  return Number.isFinite(
    value,
  )
    ? value
    : 0;
}

export class ParallaxController {
  private readonly layers =
    new Map<
      string,
      ActiveParallaxLayer
    >();

  public createLayer(
    config:
      ParallaxLayerConfig,
    texture:
      THREE.Texture,
    width =
      100,
    height =
      50,
  ): THREE.Mesh {
    this.removeLayer(
      config.layerId,
    );

    texture.wrapS =
      config.repeatX !==
      false
        ? THREE.RepeatWrapping
        : THREE.ClampToEdgeWrapping;

    texture.wrapT =
      config.repeatY ===
      true
        ? THREE.RepeatWrapping
        : THREE.ClampToEdgeWrapping;

    texture.magFilter =
      THREE.NearestFilter;

    texture.minFilter =
      THREE.NearestFilter;

    const safeWidth =
      Number.isFinite(
        width,
      ) &&
      width >
        0
        ? width
        : 100;

    const safeHeight =
      Number.isFinite(
        height,
      ) &&
      height >
        0
        ? height
        : 50;

    const geometry =
      new THREE.PlaneGeometry(
        safeWidth,
        safeHeight,
      );

    const material =
      new THREE.MeshBasicMaterial({
        map:
          texture,
        transparent:
          true,
        depthWrite:
          false,
      });

    const mesh =
      new THREE.Mesh(
        geometry,
        material,
      );

    const depthZ =
      finiteOrZero(
        config.depthZ ??
        -10,
      );

    mesh.position.set(
      0,
      0,
      depthZ,
    );

    this.layers.set(
      config.layerId,
      {
        config,
        mesh,
        initialPosition:
          new THREE.Vector3(
            0,
            0,
            depthZ,
          ),
        factorX:
          finiteOrZero(
            config.factorX,
          ),
        factorY:
          finiteOrZero(
            config.factorY,
          ),
      },
    );

    return mesh;
  }

  public setLayerFactors(
    layerId:
      string,
    factorX:
      number,
    factorY:
      number,
  ): boolean {
    const layer =
      this.layers.get(
        layerId,
      );

    if (
      layer ===
      undefined
    ) {
      return false;
    }

    layer.factorX =
      finiteOrZero(
        factorX,
      );

    layer.factorY =
      finiteOrZero(
        factorY,
      );

    return true;
  }

  public update(
    cameraX:
      number,
    cameraY:
      number,
  ): void {
    const safeCameraX =
      finiteOrZero(
        cameraX,
      );

    const safeCameraY =
      finiteOrZero(
        cameraY,
      );

    for (
      const layer of
      this.layers.values()
    ) {
      const offsetX =
        safeCameraX *
        layer.factorX;

      const offsetY =
        safeCameraY *
        layer.factorY;

      layer.mesh.position.x =
        layer.initialPosition.x +
        safeCameraX -
        offsetX;

      layer.mesh.position.y =
        layer.initialPosition.y +
        safeCameraY -
        offsetY;

      const material =
        layer.mesh.material;

      if (
        material instanceof
          THREE.MeshBasicMaterial &&
        material.map !==
          null
      ) {
        material.map.offset.x =
          (
            safeCameraX *
            layer.factorX
          ) /
          100;
      }
    }
  }

  public hasLayer(
    layerId:
      string,
  ): boolean {
    return this.layers.has(
      layerId,
    );
  }

  public removeLayer(
    layerId:
      string,
    disposeResources =
      true,
  ): boolean {
    const layer =
      this.layers.get(
        layerId,
      );

    if (
      layer ===
      undefined
    ) {
      return false;
    }

    if (
      disposeResources
    ) {
      layer.mesh.geometry
        .dispose();

      if (
        layer.mesh.material instanceof
        THREE.Material
      ) {
        layer.mesh.material
          .dispose();
      }
    }

    this.layers.delete(
      layerId,
    );

    return true;
  }

  public clear(
    disposeResources =
      true,
  ): void {
    for (
      const layerId of
      this.layers.keys()
    ) {
      this.removeLayer(
        layerId,
        disposeResources,
      );
    }
  }
}
