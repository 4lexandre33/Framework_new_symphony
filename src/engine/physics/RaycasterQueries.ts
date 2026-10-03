import RAPIER from "@dimforge/rapier3d-compat";
import type { RaycastRequest, RaycastHit } from "../../contracts/physics/types";

export class RaycasterQueries {
  private static readonly scratchPoint = { x: 0, y: 0, z: 0 };
  private static readonly scratchNormal = { x: 0, y: 0, z: 0 };

  public static castRay(
    world: RAPIER.World,
    handleToEntityMap: Map<number, string>,
    request: RaycastRequest
  ): RaycastHit {
    const rayOrigin = new RAPIER.Vector3(request.origin.x, request.origin.y, request.origin.z);
    const rayDir = new RAPIER.Vector3(request.direction.x, request.direction.y, request.direction.z);

    const ray = new RAPIER.Ray(rayOrigin, rayDir);
    const solid = request.solid !== undefined ? request.solid : true;

    const hit = world.castRayAndGetNormal(ray, request.maxDistance, solid);

    if (!hit) {
      return {
        hit: false,
        distance: 0,
        point: { x: 0, y: 0, z: 0 },
        normal: { x: 0, y: 0, z: 0 },
      };
    }

    // No Rapier WASM, o tempo de impacto / distância do raio é retornado na propriedade .toi
    const hitPoint = ray.pointAt(hit.toi);

    (this.scratchPoint as any).x = hitPoint.x;
    (this.scratchPoint as any).y = hitPoint.y;
    (this.scratchPoint as any).z = hitPoint.z;

    (this.scratchNormal as any).x = hit.normal.x;
    (this.scratchNormal as any).y = hit.normal.y;
    (this.scratchNormal as any).z = hit.normal.z;

    const entityId = handleToEntityMap.get(hit.collider.handle);

    return {
      hit: true,
      distance: hit.toi,
      point: this.scratchPoint,
      normal: this.scratchNormal,
      entityId,
    };
  }
}