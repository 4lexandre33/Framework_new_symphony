import RAPIER from "@dimforge/rapier3d-compat";

import type {
  OverlapQueryRequest,
  PhysicsQueryFilter,
  QuaternionDTO,
  RaycastHit,
  RaycastRequest,
  ShapeCastHit,
  ShapeCastRequest,
  Vector3DTO,
} from "../../../contracts/physics/types";

import {
  RigidBodyFactory,
  assertQuaternion,
  assertVector3,
  toInteractionGroups,
} from "./RigidBodyFactory";

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

/** Filtro já resolvido para os argumentos opcionais das consultas do Rapier. */
export interface ResolvedQueryFilter {
  readonly flags: number | undefined;
  readonly groups: number | undefined;
  readonly excludeBody: RAPIER.RigidBody | undefined;
  readonly predicate: ((collider: RAPIER.Collider) => boolean) | undefined;
}

// O flag EXCLUDE_SENSORS do Rapier 0.12 não é respeitado em todas as consultas;
// o predicado garante o filtro de sensores de forma explícita.
const NOT_SENSOR_PREDICATE = (
  collider: RAPIER.Collider,
): boolean => !collider.isSensor();

export function resolveQueryFilter(
  filter: PhysicsQueryFilter,
  bodyLookup: ReadonlyMap<string, RAPIER.RigidBody>,
): ResolvedQueryFilter {
  return {
    flags:
      filter.excludeSensors === true
        ? RAPIER.QueryFilterFlags.EXCLUDE_SENSORS
        : undefined,
    groups:
      filter.collisionGroups === undefined
        ? undefined
        : toInteractionGroups(filter.collisionGroups),
    excludeBody:
      filter.excludeEntityId === undefined
        ? undefined
        : bodyLookup.get(filter.excludeEntityId),
    predicate:
      filter.excludeSensors === true
        ? NOT_SENSOR_PREDICATE
        : undefined,
  };
}

function missRay(): RaycastHit {
  return {
    hit: false,
    distance: 0,
    point: { x: 0, y: 0, z: 0 },
    normal: { x: 0, y: 0, z: 0 },
  };
}


function normalizedDirection(
  direction: Vector3DTO,
  label: string,
): Vector3DTO {
  assertVector3(direction, label);

  const lengthSquared =
    direction.x * direction.x +
    direction.y * direction.y +
    direction.z * direction.z;

  if (lengthSquared <= Number.EPSILON) {
    throw new RangeError(
      `${label} não pode ser o vetor zero.`,
    );
  }

  const inverseLength =
    1 / Math.sqrt(lengthSquared);

  return {
    x: direction.x * inverseLength,
    y: direction.y * inverseLength,
    z: direction.z * inverseLength,
  };
}

function assertMaxDistance(
  value: number,
  label: string,
): void {
  assertFinite(value, label);

  if (value < 0) {
    throw new RangeError(
      `${label} precisa ser >= 0.`,
    );
  }
}

function toRapierRotation(
  rotation: QuaternionDTO | undefined,
): RAPIER.Quaternion {
  if (rotation === undefined) {
    return new RAPIER.Quaternion(0, 0, 0, 1);
  }

  assertQuaternion(rotation);

  return new RAPIER.Quaternion(
    rotation.x,
    rotation.y,
    rotation.z,
    rotation.w,
  );
}

export class RaycasterQueries {
  public static castRay(
    world: RAPIER.World,
    handleToEntityMap: ReadonlyMap<number, string>,
    request: RaycastRequest,
    bodyLookup: ReadonlyMap<string, RAPIER.RigidBody> = new Map(),
  ): RaycastHit {
    assertVector3(request.origin, "ray.origin");
    assertMaxDistance(request.maxDistance, "ray.maxDistance");

    const direction =
      normalizedDirection(request.direction, "ray.direction");

    const filter =
      resolveQueryFilter(request, bodyLookup);

    const ray = new RAPIER.Ray(
      new RAPIER.Vector3(
        request.origin.x,
        request.origin.y,
        request.origin.z,
      ),
      new RAPIER.Vector3(
        direction.x,
        direction.y,
        direction.z,
      ),
    );

    const hit = world.castRayAndGetNormal(
      ray,
      request.maxDistance,
      request.solid ?? true,
      filter.flags,
      filter.groups,
      undefined,
      filter.excludeBody,
      filter.predicate,
    );

    if (hit === null || hit === undefined) {
      return missRay();
    }

    const distance = hit.toi;
    const entityId =
      handleToEntityMap.get(hit.collider.handle);

    return {
      hit: true,
      distance,
      point: {
        x: request.origin.x + direction.x * distance,
        y: request.origin.y + direction.y * distance,
        z: request.origin.z + direction.z * distance,
      },
      normal: {
        x: hit.normal.x,
        y: hit.normal.y,
        z: hit.normal.z,
      },
      ...(entityId === undefined ? {} : { entityId }),
    };
  }

  public static castShape(
    world: RAPIER.World,
    handleToEntityMap: ReadonlyMap<number, string>,
    request: ShapeCastRequest,
    bodyLookup: ReadonlyMap<string, RAPIER.RigidBody>,
  ): ShapeCastHit {
    assertVector3(request.position, "shapeCast.position");
    assertMaxDistance(request.maxDistance, "shapeCast.maxDistance");

    const direction =
      normalizedDirection(request.direction, "shapeCast.direction");

    const shape =
      RigidBodyFactory.createQueryShape(request.shape);

    const filter =
      resolveQueryFilter(request, bodyLookup);

    const hit = world.castShape(
      new RAPIER.Vector3(
        request.position.x,
        request.position.y,
        request.position.z,
      ),
      toRapierRotation(request.rotation),
      new RAPIER.Vector3(
        direction.x,
        direction.y,
        direction.z,
      ),
      shape,
      request.maxDistance,
      true,
      filter.flags,
      filter.groups,
      undefined,
      filter.excludeBody,
      filter.predicate,
    );

    if (hit === null || hit === undefined) {
      return missRay();
    }

    // No Rapier 0.12 (JS) o lado "1" do ShapeColliderTOI é o collider atingido e
    // witness1/normal1 já chegam em coordenadas de mundo (verificado em teste
    // com collider rotacionado).
    const entityId =
      handleToEntityMap.get(hit.collider.handle);

    return {
      hit: true,
      distance: hit.toi,
      point: {
        x: hit.witness1.x,
        y: hit.witness1.y,
        z: hit.witness1.z,
      },
      normal: {
        x: hit.normal1.x,
        y: hit.normal1.y,
        z: hit.normal1.z,
      },
      ...(entityId === undefined ? {} : { entityId }),
    };
  }

  public static queryOverlap(
    world: RAPIER.World,
    handleToEntityMap: ReadonlyMap<number, string>,
    request: OverlapQueryRequest,
    bodyLookup: ReadonlyMap<string, RAPIER.RigidBody>,
  ): string[] {
    assertVector3(request.position, "overlap.position");

    const shape =
      RigidBodyFactory.createQueryShape(request.shape);

    const filter =
      resolveQueryFilter(request, bodyLookup);

    const seen = new Set<string>();
    const results: string[] = [];

    world.intersectionsWithShape(
      new RAPIER.Vector3(
        request.position.x,
        request.position.y,
        request.position.z,
      ),
      toRapierRotation(request.rotation),
      shape,
      (collider): boolean => {
        const entityId =
          handleToEntityMap.get(collider.handle);

        if (
          entityId !== undefined &&
          !seen.has(entityId)
        ) {
          seen.add(entityId);
          results.push(entityId);
        }

        return true;
      },
      filter.flags,
      filter.groups,
      undefined,
      filter.excludeBody,
      filter.predicate,
    );

    return results;
  }
}
