import * as THREE from "three";

import type {
  SpringArmConfig,
  Vector3Camera,
} from "../../../contracts/camera/types";

import type {
  RaycastRequest,
} from "../../../contracts/physics/types";

import type {
  PhysicsApi,
} from "../../../tokens/physics";

interface MutableVector3DTO {
  x:
    number;

  y:
    number;

  z:
    number;
}

interface MutableRaycastRequest {
  readonly origin:
    MutableVector3DTO;

  readonly direction:
    MutableVector3DTO;

  maxDistance:
    number;

  solid:
    boolean;

  excludeEntityId:
    string | undefined;

  excludeSensors:
    boolean;
}

function finiteNonNegative(
  value:
    number,
  fallback:
    number,
): number {
  return (
    Number.isFinite(
      value,
    ) &&
    value >=
      0
  )
    ? value
    : fallback;
}

export class SpringArm3D {
  private currentArmLength:
    number;

  private isColliding =
    false;

  private readonly scratchTargetPos =
    new THREE.Vector3();

  private readonly scratchTargetOffset =
    new THREE.Vector3();

  private readonly scratchSocketPos =
    new THREE.Vector3();

  private readonly scratchSocketOffset =
    new THREE.Vector3();

  private readonly scratchArmDir =
    new THREE.Vector3();

  private readonly scratchActualCamPos =
    new THREE.Vector3();

  private readonly rayRequest:
    MutableRaycastRequest = {
      origin: {
        x:
          0,
        y:
          0,
        z:
          0,
      },

      direction: {
        x:
          0,
        y:
          0,
        z:
          1,
      },

      maxDistance:
        0,

      solid:
        true,

      excludeEntityId:
        undefined,

      excludeSensors:
        true,
    };

  public constructor(
    private config:
      SpringArmConfig,
  ) {
    this.currentArmLength =
      finiteNonNegative(
        config.targetArmLength,
        0,
      );
  }

  public get armLength():
    number {
    return this.currentArmLength;
  }

  public get targetArmLength():
    number {
    return finiteNonNegative(
      this.config.targetArmLength,
      0,
    );
  }

  public get isCurrentlyColliding():
    boolean {
    return this.isColliding;
  }

  public updateConfig(
    newConfig:
      Partial<SpringArmConfig>,
  ): void {
    this.config = {
      ...this.config,
      ...newConfig,
    };

    const targetLength =
      this.targetArmLength;

    if (
      this.currentArmLength >
      targetLength
    ) {
      this.currentArmLength =
        targetLength;
    }
  }

  public computeCameraPosition(
    targetWorldPos:
      Vector3Camera,
    cameraRotation:
      THREE.Quaternion,
    physics?:
      PhysicsApi | null,
    deltaSeconds =
      1 /
      60,
    ignoreEntityId?:
      string,
  ): THREE.Vector3 {
    const targetArmLength =
      this.targetArmLength;

    const probeRadius =
      finiteNonNegative(
        this.config.probeRadius,
        0,
      );

    const socketOffset =
      this.config.socketOffset;

    const targetOffset =
      this.config.targetOffset;

    this.scratchTargetPos.set(
      targetWorldPos.x,
      targetWorldPos.y,
      targetWorldPos.z,
    );

    this.scratchTargetOffset.set(
      targetOffset.x,
      targetOffset.y,
      targetOffset.z,
    );

    this.scratchTargetPos.add(
      this.scratchTargetOffset,
    );

    this.scratchArmDir
      .set(
        0,
        0,
        1,
      )
      .applyQuaternion(
        cameraRotation,
      )
      .normalize();

    this.scratchSocketOffset
      .set(
        socketOffset.x,
        socketOffset.y,
        socketOffset.z,
      )
      .applyQuaternion(
        cameraRotation,
      );

    this.scratchSocketPos
      .copy(
        this.scratchTargetPos,
      )
      .add(
        this.scratchSocketOffset,
      );

    let effectiveLength =
      targetArmLength;

    this.isColliding =
      false;

    // G45: o raio sai de dentro do collider do alvo; sem uma entidade a
    // ignorar a colisão só liga com `enableCollision: true` explícito.
    const ignoredEntity =
      this.config
        .collisionIgnoreEntityId ??
      ignoreEntityId;

    const collisionEnabled =
      this.config.enableCollision ===
        true ||
      (
        this.config.enableCollision ===
          undefined &&
        ignoredEntity !==
          undefined
      );

    if (
      collisionEnabled &&
      physics !==
        null &&
      physics !==
        undefined &&
      targetArmLength >
        0
    ) {
      const origin =
        this.rayRequest
          .origin;

      origin.x =
        this.scratchSocketPos.x;

      origin.y =
        this.scratchSocketPos.y;

      origin.z =
        this.scratchSocketPos.z;

      const direction =
        this.rayRequest
          .direction;

      direction.x =
        this.scratchArmDir.x;

      direction.y =
        this.scratchArmDir.y;

      direction.z =
        this.scratchArmDir.z;

      this.rayRequest
        .maxDistance =
          targetArmLength;

      this.rayRequest
        .excludeEntityId =
          ignoredEntity;

      const rayHit =
        physics.castRay(
          this.rayRequest as
            RaycastRequest,
        );

      if (
        rayHit.hit
      ) {
        this.isColliding =
          true;

        effectiveLength =
          Math.max(
            0.2,
            rayHit.distance -
              probeRadius,
          );
      }
    }

    if (
      effectiveLength <
      this.currentArmLength
    ) {
      this.currentArmLength =
        effectiveLength;
    } else {
      const safeDelta =
        Number.isFinite(
          deltaSeconds,
        ) &&
        deltaSeconds >
          0
          ? Math.min(
              deltaSeconds,
              0.25,
            )
          : 0;

      const smoothTime =
        finiteNonNegative(
          this.config
            .smoothTimeSeconds ??
            0.15,
          0.15,
        );

      const alpha =
        smoothTime <=
          0
          ? 1
          : 1 -
            Math.exp(
              -safeDelta /
                smoothTime,
            );

      this.currentArmLength +=
        (
          effectiveLength -
          this.currentArmLength
        ) *
        alpha;
    }

    this.scratchActualCamPos
      .copy(
        this.scratchSocketPos,
      )
      .addScaledVector(
        this.scratchArmDir,
        this.currentArmLength,
      );

    return this.scratchActualCamPos;
  }
}
