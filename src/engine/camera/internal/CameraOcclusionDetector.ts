import type {
  Vector3Camera,
} from "../../../contracts/camera/types";

import type {
  RaycastRequest,
} from "../../../contracts/physics/types";

import type {
  PhysicsApi,
} from "../../../tokens/physics";

interface MutableVector3 {
  x:
    number;

  y:
    number;

  z:
    number;
}

interface MutableRayRequest {
  readonly origin:
    MutableVector3;

  readonly direction:
    MutableVector3;

  maxDistance:
    number;

  solid:
    boolean;

  excludeEntityId:
    string | undefined;

  excludeSensors:
    boolean;
}

export class CameraOcclusionDetector {
  private readonly occludedEntityIds =
    new Set<string>();

  private readonly rayRequest:
    MutableRayRequest = {
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

  public checkOcclusion(
    cameraWorldPos:
      Vector3Camera,
    targetWorldPos:
      Vector3Camera,
    physics:
      PhysicsApi,
    ignoreEntityId?:
      string,
  ): ReadonlySet<string> {
    this.occludedEntityIds
      .clear();

    const dirX =
      targetWorldPos.x -
      cameraWorldPos.x;

    const dirY =
      targetWorldPos.y -
      cameraWorldPos.y;

    const dirZ =
      targetWorldPos.z -
      cameraWorldPos.z;

    const maxDistance =
      Math.sqrt(
        dirX *
          dirX +
        dirY *
          dirY +
        dirZ *
          dirZ,
      );

    if (
      maxDistance <=
      0.001
    ) {
      return this.occludedEntityIds;
    }

    const request =
      this.rayRequest;

    request.origin.x =
      cameraWorldPos.x;

    request.origin.y =
      cameraWorldPos.y;

    request.origin.z =
      cameraWorldPos.z;

    request.direction.x =
      dirX /
      maxDistance;

    request.direction.y =
      dirY /
      maxDistance;

    request.direction.z =
      dirZ /
      maxDistance;

    request.maxDistance =
      maxDistance;

    request.excludeEntityId =
      ignoreEntityId;

    const hit =
      physics.castRay(
        request as
          RaycastRequest,
      );

    if (
      hit.hit &&
      hit.entityId !==
        undefined
    ) {
      this.occludedEntityIds
        .add(
          hit.entityId,
        );
    }

    return this.occludedEntityIds;
  }
}
