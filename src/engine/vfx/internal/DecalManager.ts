import * as THREE from "three";

import { DecalGeometry } from "three/examples/jsm/geometries/DecalGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import type {
  DecalConfig,
} from "../../../contracts/vfx/types";

export const DEFAULT_MAX_DECALS =
  200;

const DECAL_FLAG =
  "vfxDecal";

export interface ActiveDecalInstance {
  readonly config:
    DecalConfig;

  readonly mesh:
    THREE.Mesh;

  /** true quando a geometria foi projetada sobre malhas da cena. */
  readonly projected:
    boolean;

  elapsedSeconds:
    number;
}

/**
 * Decals projetados (G90) com `DecalGeometry`: recorta os triângulos das
 * malhas que cruzam a caixa do decal. Sem malha alvo, cai para um quad
 * plano orientado pela normal.
 */
export class DecalManager {
  private readonly activeDecals:
    ActiveDecalInstance[] =
      [];

  private maxDecalsLimit =
    DEFAULT_MAX_DECALS;

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

  private readonly scratchEuler =
    new THREE.Euler();

  private readonly scratchSize =
    new THREE.Vector3();

  private readonly decalBounds =
    new THREE.Box3();

  private readonly meshBounds =
    new THREE.Box3();

  public setMaxDecals(
    maxDecals: number,
    targetScene?:
      THREE.Scene,
  ): void {
    if (
      !Number.isInteger(
        maxDecals,
      ) ||
      maxDecals <
        1
    ) {
      throw new RangeError(
        "maxDecals precisa ser inteiro >= 1.",
      );
    }

    this.maxDecalsLimit =
      maxDecals;

    while (
      this.activeDecals.length >
      this.maxDecalsLimit
    ) {
      this.removeAt(
        0,
        targetScene,
      );
    }
  }

  public getMaxDecals():
    number {
    return this.maxDecalsLimit;
  }

  /**
   * Projeta (ou substitui pelo mesmo `decalId`) um decal. `texture` null
   * deixa o decal invisível até `setDecalTexture`.
   * `targets` restringe as malhas alvo; omitido = malhas da cena.
   */
  public projectDecal(
    config:
      DecalConfig,
    texture:
      THREE.Texture | null,
    targetScene:
      THREE.Scene,
    targets?:
      THREE.Object3D | ReadonlyArray<THREE.Object3D>,
  ): THREE.Mesh {
    this.removeDecal(
      config.decalId,
      targetScene,
    );

    while (
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

    // Orientação do projetor: +Z local alinhado à normal da superfície.
    this.scratchLookAtTarget
      .copy(
        this.scratchPosition,
      )
      .add(
        this.scratchNormal,
      );

    this.scratchMatrix
      .lookAt(
        this.scratchLookAtTarget,
        this.scratchPosition,
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

    this.scratchEuler.setFromQuaternion(
      this.scratchQuaternion,
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

    this.scratchSize.set(
      sizeX,
      sizeY,
      sizeZ,
    );

    const projectedGeometry =
      this.buildProjectedGeometry(
        targetScene,
        targets,
      );

    const projected =
      projectedGeometry !==
      null;

    const geometry =
      projectedGeometry ??
      new THREE.PlaneGeometry(
        sizeX,
        sizeY,
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
          -4,
        visible:
          texture !==
          null,
      });

    const decalMesh =
      new THREE.Mesh(
        geometry,
        material,
      );

    decalMesh.userData[
      DECAL_FLAG
    ] =
      true;

    decalMesh.name =
      `vfx_decal_${config.decalId}`;

    if (
      !projected
    ) {
      // Quad em espaço local do projetor; geometria projetada já vem em mundo.
      decalMesh.position
        .copy(
          this.scratchPosition,
        );

      decalMesh.quaternion
        .copy(
          this.scratchQuaternion,
        );
    }

    targetScene.add(
      decalMesh,
    );

    this.activeDecals.push({
      config,
      mesh:
        decalMesh,
      projected,
      elapsedSeconds:
        0,
    });

    return decalMesh;
  }

  public getDecal(
    decalId: string,
  ): ActiveDecalInstance | null {
    const index =
      this.indexOf(
        decalId,
      );

    return index >=
      0
      ? (this.activeDecals[index] ?? null)
      : null;
  }

  /** Aplica a textura (carregada depois) e torna o decal visível. */
  public setDecalTexture(
    decalId: string,
    texture:
      THREE.Texture,
  ): boolean {
    const decal =
      this.getDecal(
        decalId,
      );

    if (
      decal ===
      null
    ) {
      return false;
    }

    const material =
      decal.mesh.material;

    if (
      material instanceof
      THREE.MeshBasicMaterial
    ) {
      material.map =
        texture;
      material.visible =
        true;
      material.needsUpdate =
        true;
    }

    return true;
  }

  public removeDecal(
    decalId: string,
    targetScene?:
      THREE.Scene,
  ): boolean {
    const index =
      this.indexOf(
        decalId,
      );

    if (
      index <
      0
    ) {
      return false;
    }

    this.removeAt(
      index,
      targetScene,
    );

    return true;
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

  /**
   * Gera a geometria projetada sobre as malhas que cruzam a caixa do
   * decal (em espaço de mundo), ou null se nenhuma cruza.
   */
  private buildProjectedGeometry(
    targetScene:
      THREE.Scene,
    targets?:
      THREE.Object3D | ReadonlyArray<THREE.Object3D>,
  ): THREE.BufferGeometry | null {
    const radius =
      this.scratchSize.length() *
      0.5;

    this.decalBounds.min
      .copy(
        this.scratchPosition,
      )
      .subScalar(
        radius,
      );

    this.decalBounds.max
      .copy(
        this.scratchPosition,
      )
      .addScalar(
        radius,
      );

    const candidates:
      THREE.Mesh[] =
        [];

    const visit =
      (
        object:
          THREE.Object3D,
      ): void => {
        object.traverse(
          (
            child:
              THREE.Object3D,
          ): void => {
            if (
              !(child instanceof THREE.Mesh) ||
              child instanceof THREE.InstancedMesh ||
              child instanceof THREE.SkinnedMesh ||
              child.userData[DECAL_FLAG] === true ||
              !child.visible ||
              child.geometry.getAttribute(
                "position",
              ) ===
                undefined
            ) {
              return;
            }

            child.updateWorldMatrix(
              true,
              false,
            );

            const geometry =
              child.geometry;

            if (
              geometry.boundingBox ===
              null
            ) {
              geometry.computeBoundingBox();
            }

            if (
              geometry.boundingBox ===
              null
            ) {
              return;
            }

            this.meshBounds
              .copy(
                geometry.boundingBox,
              )
              .applyMatrix4(
                child.matrixWorld,
              );

            if (
              this.meshBounds.intersectsBox(
                this.decalBounds,
              )
            ) {
              candidates.push(
                child,
              );
            }
          },
        );
      };

    if (
      targets ===
      undefined
    ) {
      visit(
        targetScene,
      );
    } else if (
      Array.isArray(
        targets,
      )
    ) {
      for (
        const target of
        targets
      ) {
        visit(
          target,
        );
      }
    } else {
      visit(
        targets as THREE.Object3D,
      );
    }

    const pieces:
      THREE.BufferGeometry[] =
        [];

    for (
      const mesh of
      candidates
    ) {
      const piece =
        new DecalGeometry(
          mesh,
          this.scratchPosition,
          this.scratchEuler,
          this.scratchSize,
        );

      const position =
        piece.getAttribute(
          "position",
        );

      if (
        position ===
          undefined ||
        position.count ===
          0
      ) {
        piece.dispose();
        continue;
      }

      // Normaliza atributos para o merge.
      if (
        piece.getAttribute(
          "normal",
        ) ===
        undefined
      ) {
        piece.computeVertexNormals();
      }

      pieces.push(
        piece,
      );
    }

    if (
      pieces.length ===
      0
    ) {
      return null;
    }

    if (
      pieces.length ===
      1
    ) {
      return pieces[0] ?? null;
    }

    const merged =
      mergeGeometries(
        pieces,
        false,
      );

    for (
      const piece of
      pieces
    ) {
      piece.dispose();
    }

    return merged;
  }

  private indexOf(
    decalId: string,
  ): number {
    for (
      let index = 0;
      index <
      this.activeDecals.length;
      index += 1
    ) {
      if (
        this.activeDecals[index]?.config
          .decalId ===
        decalId
      ) {
        return index;
      }
    }

    return -1;
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

    if (
      targetScene !==
      undefined
    ) {
      targetScene.remove(
        decal.mesh,
      );
    } else {
      decal.mesh.removeFromParent();
    }

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
