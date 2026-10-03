import type {
  Vector3Camera,
} from "../../contracts/camera/types";

import type {
  PhysicsApi,
} from "../../tokens/physics";

export class CameraOcclusionDetector {
  private readonly ocludedEntityIds =
    new Set<string>();

  public checkOcclusion(
    cameraWorldPos:
      Vector3Camera,
    targetWorldPos:
      Vector3Camera,
    physics:
      PhysicsApi,
  ): ReadonlySet<string> {
    this.ocludedEntityIds.clear();

    const dirX =
      targetWorldPos.x -
      cameraWorldPos.x;

    const dirY =
      targetWorldPos.y -
      cameraWorldPos.y;

    const dirZ =
      targetWorldPos.z -
      cameraWorldPos.z;

    const maxDist =
      Math.sqrt(
        dirX * dirX +
        dirY * dirY +
        dirZ * dirZ,
      );

    if (
      maxDist <=
      0.001
    ) {
      return this.ocludedEntityIds;
    }

    const hit =
      physics.castRay({
        origin:
          cameraWorldPos,

        direction: {
          x:
            dirX /
            maxDist,

          y:
            dirY /
            maxDist,

          z:
            dirZ /
            maxDist,
        },

        maxDistance:
          maxDist,

        solid:
          true,
      });

    if (
      hit.hit &&
      hit.entityId
    ) {
      this.ocludedEntityIds.add(
        hit.entityId,
      );
    }

    return this.ocludedEntityIds;
  }
}