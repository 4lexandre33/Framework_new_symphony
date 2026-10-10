import * as THREE from "three";

import type {
  ParallaxLayerConfig,
} from "../../../contracts/sprites/types";

interface ActiveParallaxLayer {
  readonly config:
    ParallaxLayerConfig;

  readonly mesh:
    THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;

  readonly initialPosition:
    THREE.Vector3;

  readonly width:
    number;

  readonly height:
    number;

  readonly repeatX:
    boolean;

  readonly repeatY:
    boolean;

  factorX:
    number;

  factorY:
    number;
}

const DEFAULT_LAYER_WIDTH =
  100;

const DEFAULT_LAYER_HEIGHT =
  50;

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

function positiveOr(
  value:
    number | undefined,
  fallback:
    number,
): number {
  return value !==
    undefined &&
    Number.isFinite(
      value,
    ) &&
    value >
      0
    ? value
    : fallback;
}

/**
 * Parallax 2D (G94). Fator 0 = camada presa à câmera, 1 = presa ao mundo.
 * Eixos com repeat: o quad segue a câmera e só o offset da textura rola
 * (fundo infinito). Eixos sem repeat: o quad se move câmera·(1−fator).
 * A textura usada é um CLONE próprio (wrap/filtro não afetam o cache, G95).
 */
export class ParallaxController {
  private readonly layers =
    new Map<
      string,
      ActiveParallaxLayer
    >();

  private lastCameraX =
    0;

  private lastCameraY =
    0;

  public createLayer(
    config:
      ParallaxLayerConfig,
    texture:
      THREE.Texture | null,
    width?:
      number,
    height?:
      number,
  ): THREE.Mesh {
    this.removeLayer(
      config.layerId,
    );

    const repeatX =
      config.repeatX !==
      false;

    const repeatY =
      config.repeatY ===
      true;

    const layerWidth =
      positiveOr(
        width ??
          config.width,
        DEFAULT_LAYER_WIDTH,
      );

    const layerHeight =
      positiveOr(
        height ??
          config.height,
        DEFAULT_LAYER_HEIGHT,
      );

    const geometry =
      new THREE.PlaneGeometry(
        layerWidth,
        layerHeight,
      );

    const material =
      new THREE.MeshBasicMaterial({
        map:
          texture ===
          null
            ? null
            : this.createOwnedTexture(
                texture,
                repeatX,
                repeatY,
              ),
        transparent:
          true,
        depthWrite:
          false,
        visible:
          texture !==
          null,
      });

    const mesh =
      new THREE.Mesh(
        geometry,
        material,
      );

    mesh.name =
      `parallax_${config.layerId}`;

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

    const layer: ActiveParallaxLayer = {
      config,
      mesh,
      initialPosition:
        new THREE.Vector3(
          0,
          0,
          depthZ,
        ),
      width:
        layerWidth,
      height:
        layerHeight,
      repeatX,
      repeatY,
      factorX:
        finiteOrZero(
          config.factorX,
        ),
      factorY:
        finiteOrZero(
          config.factorY,
        ),
    };

    this.layers.set(
      config.layerId,
      layer,
    );

    this.applyLayer(
      layer,
      this.lastCameraX,
      this.lastCameraY,
    );

    return mesh;
  }

  /** Aplica (ou troca) a textura de uma camada criada sem textura. */
  public setLayerTexture(
    layerId:
      string,
    texture:
      THREE.Texture,
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

    const material =
      layer.mesh.material;

    this.disposeOwnedMap(
      material,
    );

    material.map =
      this.createOwnedTexture(
        texture,
        layer.repeatX,
        layer.repeatY,
      );
    material.visible =
      true;
    material.needsUpdate =
      true;

    this.applyLayer(
      layer,
      this.lastCameraX,
      this.lastCameraY,
    );

    return true;
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

    this.lastCameraX =
      safeCameraX;

    this.lastCameraY =
      safeCameraY;

    for (
      const layer of
      this.layers.values()
    ) {
      this.applyLayer(
        layer,
        safeCameraX,
        safeCameraY,
      );
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

  public getLayerMesh(
    layerId:
      string,
  ): THREE.Mesh | null {
    return this.layers.get(
      layerId,
    )?.mesh ??
      null;
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

    layer.mesh.removeFromParent();

    if (
      disposeResources
    ) {
      layer.mesh.geometry
        .dispose();

      this.disposeOwnedMap(
        layer.mesh.material,
      );

      layer.mesh.material
        .dispose();
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
      [...this.layers.keys()]
    ) {
      this.removeLayer(
        layerId,
        disposeResources,
      );
    }
  }

  private applyLayer(
    layer:
      ActiveParallaxLayer,
    cameraX:
      number,
    cameraY:
      number,
  ): void {
    const map =
      layer.mesh.material.map;

    // Deslocamento do conteúdo em relação ao mundo: câmera·(1−fator).
    if (
      layer.repeatX
    ) {
      layer.mesh.position.x =
        layer.initialPosition.x +
        cameraX;

      if (
        map !==
        null
      ) {
        map.offset.x =
          (
            cameraX *
            layer.factorX
          ) /
          layer.width;
      }
    } else {
      layer.mesh.position.x =
        layer.initialPosition.x +
        cameraX *
          (
            1 -
            layer.factorX
          );

      if (
        map !==
        null
      ) {
        map.offset.x =
          0;
      }
    }

    if (
      layer.repeatY
    ) {
      layer.mesh.position.y =
        layer.initialPosition.y +
        cameraY;

      if (
        map !==
        null
      ) {
        map.offset.y =
          (
            cameraY *
            layer.factorY
          ) /
          layer.height;
      }
    } else {
      layer.mesh.position.y =
        layer.initialPosition.y +
        cameraY *
          (
            1 -
            layer.factorY
          );

      if (
        map !==
        null
      ) {
        map.offset.y =
          0;
      }
    }
  }

  private createOwnedTexture(
    source:
      THREE.Texture,
    repeatX:
      boolean,
    repeatY:
      boolean,
  ): THREE.Texture {
    const owned =
      source.clone();

    owned.wrapS =
      repeatX
        ? THREE.RepeatWrapping
        : THREE.ClampToEdgeWrapping;

    owned.wrapT =
      repeatY
        ? THREE.RepeatWrapping
        : THREE.ClampToEdgeWrapping;

    owned.magFilter =
      THREE.NearestFilter;

    owned.minFilter =
      THREE.NearestFilter;

    owned.userData.presentationOwned =
      true;

    owned.needsUpdate =
      true;

    return owned;
  }

  private disposeOwnedMap(
    material:
      THREE.MeshBasicMaterial,
  ): void {
    const map =
      material.map;

    if (
      map !==
        null &&
      map.userData
        .presentationOwned ===
        true
    ) {
      map.dispose();
    }
  }
}
