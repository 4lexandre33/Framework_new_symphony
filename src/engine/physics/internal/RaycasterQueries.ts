import RAPIER from "@dimforge/rapier3d-compat";

import type {
  RaycastHit,
  RaycastRequest,
} from "../../../contracts/physics/types";

function assertFinite(
  value: number,
  label: string,
): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(
      `${label} precisa ser finito.`,
    );
  }
}

export class RaycasterQueries {
  public static castRay(
    world: RAPIER.World,
    handleToEntityMap:
      ReadonlyMap<number, string>,
    request: RaycastRequest,
  ): RaycastHit {
    assertFinite(
      request.origin.x,
      "ray.origin.x",
    );

    assertFinite(
      request.origin.y,
      "ray.origin.y",
    );

    assertFinite(
      request.origin.z,
      "ray.origin.z",
    );

    assertFinite(
      request.direction.x,
      "ray.direction.x",
    );

    assertFinite(
      request.direction.y,
      "ray.direction.y",
    );

    assertFinite(
      request.direction.z,
      "ray.direction.z",
    );

    assertFinite(
      request.maxDistance,
      "ray.maxDistance",
    );

    if (
      request.maxDistance <
      0
    ) {
      throw new RangeError(
        "ray.maxDistance precisa ser >= 0.",
      );
    }

    const lengthSquared =
      request.direction.x *
        request.direction.x +
      request.direction.y *
        request.direction.y +
      request.direction.z *
        request.direction.z;

    if (
      lengthSquared <=
      Number.EPSILON
    ) {
      throw new RangeError(
        "ray.direction não pode ser o vetor zero.",
      );
    }

    const inverseLength =
      1 /
      Math.sqrt(
        lengthSquared,
      );

    const direction =
      new RAPIER.Vector3(
        request.direction.x *
          inverseLength,
        request.direction.y *
          inverseLength,
        request.direction.z *
          inverseLength,
      );

    const origin =
      new RAPIER.Vector3(
        request.origin.x,
        request.origin.y,
        request.origin.z,
      );

    const ray =
      new RAPIER.Ray(
        origin,
        direction,
      );

    const hit =
      world.castRayAndGetNormal(
        ray,
        request.maxDistance,
        request.solid ??
          true,
      );

    if (
      hit ===
        null ||
      hit ===
        undefined
    ) {
      return {
        hit:
          false,
        distance:
          0,
        point: {
          x:
            0,
          y:
            0,
          z:
            0,
        },
        normal: {
          x:
            0,
          y:
            0,
          z:
            0,
        },
      };
    }

    const distance =
      hit.toi;

    const entityId =
      handleToEntityMap.get(
        hit.collider.handle,
      );

    return {
      hit:
        true,
      distance,
      point: {
        x:
          request.origin.x +
          direction.x *
            distance,
        y:
          request.origin.y +
          direction.y *
            distance,
        z:
          request.origin.z +
          direction.z *
            distance,
      },
      normal: {
        x:
          hit.normal.x,
        y:
          hit.normal.y,
        z:
          hit.normal.z,
      },
      ...(entityId ===
      undefined
        ? {}
        : {
            entityId,
          }),
    };
  }
}
