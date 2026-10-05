import * as THREE from "three";

import type {
  DecalConfig,
} from "../../../contracts/vfx/types";

export interface ActiveDecalInstance {
  readonly config:
    DecalConfig;

  readonly mesh:
    THREE.Mesh;

  elapsedSeconds:
    number;
}

export class DecalManager {
  private readonly activeDecals:
    ActiveDecalInstance[] =
      [];

  private readonly maxDecalsLimit =
    200;

  private readonly scratchPosition =
    new THREE.Vector3();

  private readonly scratchNormal =
    new THREE.Vector3();

  private readonly scratchLookAtTarget =
    new THREE.Vector3();

  private readonly scratchUp =
    new THREE.Vector3(
      0,
      1,
      0,
    );

  private readonly scratchAlternateUp =
    new THREE.Vector3(
      0,
      0,
      1,
    );

  private readonly scratchMatrix =
    new THREE.Matrix4();

  private readonly scratchQuaternion =
    new THREE.Quaternion();

  public projectDecal(
    config:
      DecalConfig,
    texture:
      THREE.Texture,
    targetScene:
      THREE.Scene,
  ): THREE.Mesh {
    if (
      this.activeDecals.length >=
      this.maxDecalsLimit
    ) {
      this.removeAt(
        0,
        targetScene,
      );
    }

    this.scratchPosition.set(
      config.position.x,
      config.position.y,
      config.position.z,
    );

    this.scratchNormal.set(
      config.orientationNormal.x,
      config.orientationNormal.y,
      config.orientationNormal.z,
    );

    if (
      this.scratchNormal
        .lengthSq() <=
      0.000001
    ) {
      this.scratchNormal.set(
        0,
        1,
        0,
      );
    } else {
      this.scratchNormal
        .normalize();
    }

    this.scratchLookAtTarget
      .copy(
        this.scratchPosition,
      )
      .add(
        this.scratchNormal,
      );

    this.scratchMatrix
      .lookAt(
        this.scratchPosition,
        this.scratchLookAtTarget,
        Math.abs(
          this.scratchNormal.y,
        ) >
          0.99
          ? this.scratchAlternateUp
          : this.scratchUp,
      );

    this.scratchQuaternion
      .setFromRotationMatrix(
        this.scratchMatrix,
      );

    const sizeX =
      this.positiveFiniteOr(
        config.size.x,
        0.01,
      );

    const sizeY =
      this.positiveFiniteOr(
        config.size.y,
        0.01,
      );

    const sizeZ =
      this.positiveFiniteOr(
        config.size.z,
        0.01,
      );

    const geometry =
      new THREE.BoxGeometry(
        sizeX,
        sizeY,
        sizeZ,
      );

    const material =
      new THREE.MeshBasicMaterial({
        map:
          texture,
        transparent:
          true,
        opacity:
          1,
        depthWrite:
          false,
        polygonOffset:
          true,
        polygonOffsetFactor:
          -2,
      });

    const decalMesh =
      new THREE.Mesh(
        geometry,
        material,
      );

    decalMesh.position
      .copy(
        this.scratchPosition,
      );

    decalMesh.quaternion
      .copy(
        this.scratchQuaternion,
      );

    targetScene.add(
      decalMesh,
    );

    this.activeDecals.push({
      config,
      mesh:
        decalMesh,
      elapsedSeconds:
        0,
    });

    return decalMesh;
  }

  public update(
    deltaSeconds:
      number,
    targetScene?:
      THREE.Scene,
  ): void {
    if (
      !Number.isFinite(
        deltaSeconds,
      ) ||
      deltaSeconds <=
        0
    ) {
      return;
    }

    const safeDelta =
      Math.min(
        deltaSeconds,
        0.25,
      );

    for (
      let index =
        this.activeDecals.length -
        1;
      index >=
        0;
      index -=
        1
    ) {
      const decal =
        this.activeDecals[
          index
        ];

      if (
        decal ===
        undefined
      ) {
        continue;
      }

      const lifetime =
        decal.config
          .lifetimeSeconds;

      if (
        lifetime ===
          undefined ||
        !Number.isFinite(
          lifetime,
        ) ||
        lifetime <=
          0
      ) {
        continue;
      }

      decal.elapsedSeconds +=
        safeDelta;

      const remaining =
        lifetime -
        decal.elapsedSeconds;

      if (
        remaining <=
        0
      ) {
        this.removeAt(
          index,
          targetScene,
        );

        continue;
      }

      const fadeDuration =
        decal.config
          .fadeDurationSeconds;

      if (
        fadeDuration ===
          undefined ||
        !Number.isFinite(
          fadeDuration,
        ) ||
        fadeDuration <=
          0 ||
        remaining >
          fadeDuration
      ) {
        continue;
      }

      const material =
        decal.mesh.material;

      if (
        material instanceof
        THREE.MeshBasicMaterial
      ) {
        material.opacity =
          Math.min(
            1,
            Math.max(
              0,
              remaining /
                fadeDuration,
            ),
          );
      }
    }
  }

  public getActiveDecalCount():
    number {
    return this.activeDecals
      .length;
  }

  public clear(
    targetScene?:
      THREE.Scene,
  ): void {
    for (
      let index =
        this.activeDecals.length -
        1;
      index >=
        0;
      index -=
        1
    ) {
      this.removeAt(
        index,
        targetScene,
      );
    }
  }

  private removeAt(
    index:
      number,
    targetScene?:
      THREE.Scene,
  ): void {
    const decal =
      this.activeDecals[
        index
      ];

    if (
      decal ===
      undefined
    ) {
      return;
    }

    targetScene?.remove(
      decal.mesh,
    );

    decal.mesh.geometry
      .dispose();

    const material =
      decal.mesh.material;

    if (
      material instanceof
      THREE.Material
    ) {
      if (
        material instanceof
          THREE.MeshBasicMaterial &&
        material.map !==
          null &&
        material.map
          .userData
          .presentationOwned ===
          true
      ) {
        material.map
          .dispose();
      }

      material.dispose();
    }

    this.activeDecals.splice(
      index,
      1,
    );
  }

  private positiveFiniteOr(
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
}
