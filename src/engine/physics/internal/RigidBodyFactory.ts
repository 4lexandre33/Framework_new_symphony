import RAPIER from "@dimforge/rapier3d-compat";

import type {
  AxisFlagsDTO,
  ColliderDescriptor,
  CollisionGroupsDTO,
  QuaternionDTO,
  QueryShapeDescriptor,
  RigidBodyDescriptor,
  Vector3DTO,
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

function assertNonNegative(
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

function assertPositive(
  value: number,
  label: string,
): void {
  assertFinite(value, label);

  if (value <= 0) {
    throw new RangeError(
      `${label} precisa ser > 0.`,
    );
  }
}

export function assertVector3(
  value: Vector3DTO,
  label: string,
): void {
  if (
    typeof value !== "object" ||
    value === null
  ) {
    throw new RangeError(
      `${label} precisa ser um vetor {x,y,z}.`,
    );
  }

  assertFinite(value.x, `${label}.x`);
  assertFinite(value.y, `${label}.y`);
  assertFinite(value.z, `${label}.z`);
}

export function assertQuaternion(
  value: QuaternionDTO,
  label = "rotation",
): void {
  if (
    typeof value !== "object" ||
    value === null
  ) {
    throw new RangeError(
      `${label} precisa ser um quaternion {x,y,z,w}.`,
    );
  }

  assertFinite(value.x, `${label}.x`);
  assertFinite(value.y, `${label}.y`);
  assertFinite(value.z, `${label}.z`);
  assertFinite(value.w, `${label}.w`);

  const normSquared =
    value.x * value.x +
    value.y * value.y +
    value.z * value.z +
    value.w * value.w;

  if (normSquared <= Number.EPSILON) {
    throw new RangeError(
      `${label} não pode ser um quaternion de norma zero.`,
    );
  }
}

function assertAxisFlags(
  value: AxisFlagsDTO,
  label: string,
): void {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof value.x !== "boolean" ||
    typeof value.y !== "boolean" ||
    typeof value.z !== "boolean"
  ) {
    throw new RangeError(
      `${label} precisa ser {x:boolean,y:boolean,z:boolean}.`,
    );
  }
}

function assertGroupMask(
  value: number,
  label: string,
): void {
  if (
    !Number.isInteger(value) ||
    value < 0 ||
    value > 0xffff
  ) {
    throw new RangeError(
      `${label} precisa ser inteiro entre 0 e 0xffff.`,
    );
  }
}

/**
 * Converte grupos de colisão (16 bits de membership + 16 bits de filtro)
 * para o InteractionGroups do Rapier.
 */
export function toInteractionGroups(
  groups: CollisionGroupsDTO,
): number {
  if (
    typeof groups !== "object" ||
    groups === null
  ) {
    throw new RangeError(
      "collisionGroups precisa ser {memberships, filter}.",
    );
  }

  assertGroupMask(groups.memberships, "collisionGroups.memberships");
  assertGroupMask(groups.filter, "collisionGroups.filter");

  return (
    ((groups.memberships & 0xffff) << 16) |
    (groups.filter & 0xffff)
  ) >>> 0;
}

function assertTrimesh(
  vertices: Float32Array,
  indices: Uint32Array,
): void {
  if (
    vertices.length < 9 ||
    vertices.length % 3 !== 0
  ) {
    throw new RangeError(
      "Trimesh.vertices precisa conter ao menos 3 vértices e ter tamanho múltiplo de 3.",
    );
  }

  if (
    indices.length < 3 ||
    indices.length % 3 !== 0
  ) {
    throw new RangeError(
      "Trimesh.indices precisa conter ao menos um triângulo e ter tamanho múltiplo de 3.",
    );
  }

  const vertexCount =
    vertices.length / 3;

  for (let index = 0; index < vertices.length; index += 1) {
    assertFinite(
      vertices[index] ?? Number.NaN,
      `vertices[${String(index)}]`,
    );
  }

  for (let index = 0; index < indices.length; index += 1) {
    const vertexIndex =
      indices[index];

    if (
      vertexIndex === undefined ||
      vertexIndex >= vertexCount
    ) {
      throw new RangeError(
        `indices[${String(index)}] referencia vértice inexistente.`,
      );
    }
  }
}

function assertPointCloud(
  points: Float32Array,
): void {
  if (
    points.length < 12 ||
    points.length % 3 !== 0
  ) {
    throw new RangeError(
      "convexHull.vertices precisa conter ao menos 4 pontos (x,y,z).",
    );
  }

  for (let index = 0; index < points.length; index += 1) {
    assertFinite(
      points[index] ?? Number.NaN,
      `vertices[${String(index)}]`,
    );
  }
}

function readHalfHeight(
  config: { readonly halfHeight?: number },
  fallback: number,
): number {
  const halfHeight =
    config.halfHeight ?? fallback;

  assertPositive(halfHeight, "halfHeight");

  return halfHeight;
}

function readRadius(
  config: { readonly radius?: number },
  fallback: number,
): number {
  const radius =
    config.radius ?? fallback;

  assertPositive(radius, "radius");

  return radius;
}

function readHalfExtents(
  config: { readonly halfExtents?: Vector3DTO },
): readonly [number, number, number] {
  const halfX = config.halfExtents?.x ?? 0.5;
  const halfY = config.halfExtents?.y ?? 0.5;
  const halfZ = config.halfExtents?.z ?? 0.5;

  assertPositive(halfX, "halfExtents.x");
  assertPositive(halfY, "halfExtents.y");
  assertPositive(halfZ, "halfExtents.z");

  return [halfX, halfY, halfZ];
}

export class RigidBodyFactory {
  public static createRigidBodyDesc(
    config: RigidBodyDescriptor,
  ): RAPIER.RigidBodyDesc {
    let desc: RAPIER.RigidBodyDesc;

    switch (config.bodyType) {
      case "dynamic":
        desc = RAPIER.RigidBodyDesc.dynamic();
        break;

      case "fixed":
        desc = RAPIER.RigidBodyDesc.fixed();
        break;

      case "kinematicPositionBased":
        desc = RAPIER.RigidBodyDesc.kinematicPositionBased();
        break;

      case "kinematicVelocityBased":
        desc = RAPIER.RigidBodyDesc.kinematicVelocityBased();
        break;

      default:
        throw new RangeError(
          `RigidBodyType inválido: ${String(config.bodyType)}.`,
        );
    }

    if (config.position !== undefined) {
      assertVector3(config.position, "position");

      desc.setTranslation(
        config.position.x,
        config.position.y,
        config.position.z,
      );
    }

    if (config.rotation !== undefined) {
      assertQuaternion(config.rotation);

      desc.setRotation(
        new RAPIER.Quaternion(
          config.rotation.x,
          config.rotation.y,
          config.rotation.z,
          config.rotation.w,
        ),
      );
    }

    if (config.linearDamping !== undefined) {
      assertNonNegative(config.linearDamping, "linearDamping");
      desc.setLinearDamping(config.linearDamping);
    }

    if (config.angularDamping !== undefined) {
      assertNonNegative(config.angularDamping, "angularDamping");
      desc.setAngularDamping(config.angularDamping);
    }

    if (config.gravityScale !== undefined) {
      assertFinite(config.gravityScale, "gravityScale");
      desc.setGravityScale(config.gravityScale);
    }

    if (config.canSleep !== undefined) {
      desc.setCanSleep(config.canSleep);
    }

    if (config.enabledRotations !== undefined) {
      assertAxisFlags(config.enabledRotations, "enabledRotations");

      desc.enabledRotations(
        config.enabledRotations.x,
        config.enabledRotations.y,
        config.enabledRotations.z,
      );
    }

    if (config.lockRotations === true) {
      desc.lockRotations();
    }

    if (config.lockTranslations === true) {
      desc.lockTranslations();
    }

    if (config.linearVelocity !== undefined) {
      assertVector3(config.linearVelocity, "linearVelocity");

      desc.setLinvel(
        config.linearVelocity.x,
        config.linearVelocity.y,
        config.linearVelocity.z,
      );
    }

    if (config.angularVelocity !== undefined) {
      assertVector3(config.angularVelocity, "angularVelocity");

      desc.setAngvel(
        new RAPIER.Vector3(
          config.angularVelocity.x,
          config.angularVelocity.y,
          config.angularVelocity.z,
        ),
      );
    }

    if (config.ccd !== undefined) {
      desc.setCcdEnabled(config.ccd);
    }

    if (config.additionalMass !== undefined) {
      assertNonNegative(config.additionalMass, "additionalMass");
      desc.setAdditionalMass(config.additionalMass);
    }

    return desc;
  }

  public static createColliderDesc(
    config: ColliderDescriptor,
  ): RAPIER.ColliderDesc {
    let desc: RAPIER.ColliderDesc;

    switch (config.shapeType) {
      case "box": {
        const [halfX, halfY, halfZ] =
          readHalfExtents(config);

        desc = RAPIER.ColliderDesc.cuboid(halfX, halfY, halfZ);
        break;
      }

      case "sphere":
        desc = RAPIER.ColliderDesc.ball(
          readRadius(config, 0.5),
        );
        break;

      case "capsule": {
        const halfHeight =
          config.halfHeight ?? 0.5;

        assertNonNegative(halfHeight, "halfHeight");

        desc = RAPIER.ColliderDesc.capsule(
          halfHeight,
          readRadius(config, 0.25),
        );
        break;
      }

      case "cylinder":
        desc = RAPIER.ColliderDesc.cylinder(
          readHalfHeight(config, 0.5),
          readRadius(config, 0.5),
        );
        break;

      case "cone":
        desc = RAPIER.ColliderDesc.cone(
          readHalfHeight(config, 0.5),
          readRadius(config, 0.5),
        );
        break;

      case "convexHull": {
        if (config.vertices === undefined) {
          throw new RangeError(
            "[RigidBodyFactory] convexHull requer vertices (pontos x,y,z).",
          );
        }

        assertPointCloud(config.vertices);

        const hull =
          RAPIER.ColliderDesc.convexHull(config.vertices);

        if (hull === null) {
          throw new RangeError(
            "[RigidBodyFactory] convexHull degenerado (pontos coplanares/colineares).",
          );
        }

        desc = hull;
        break;
      }

      case "heightfield": {
        const rows = config.rows;
        const cols = config.cols;
        const heights = config.heights;

        if (
          rows === undefined ||
          cols === undefined ||
          heights === undefined ||
          !Number.isInteger(rows) ||
          !Number.isInteger(cols) ||
          rows < 1 ||
          cols < 1
        ) {
          throw new RangeError(
            "[RigidBodyFactory] heightfield requer rows/cols inteiros >= 1 e heights.",
          );
        }

        if (heights.length !== (rows + 1) * (cols + 1)) {
          throw new RangeError(
            "[RigidBodyFactory] heightfield.heights precisa ter (rows+1)*(cols+1) valores.",
          );
        }

        for (let index = 0; index < heights.length; index += 1) {
          assertFinite(
            heights[index] ?? Number.NaN,
            `heights[${String(index)}]`,
          );
        }

        const scale =
          config.scale ?? { x: 1, y: 1, z: 1 };

        assertPositive(scale.x, "scale.x");
        assertFinite(scale.y, "scale.y");
        assertPositive(scale.z, "scale.z");

        desc = RAPIER.ColliderDesc.heightfield(
          rows,
          cols,
          heights,
          new RAPIER.Vector3(scale.x, scale.y, scale.z),
        );
        break;
      }

      case "trimesh": {
        if (
          config.vertices === undefined ||
          config.indices === undefined
        ) {
          throw new Error(
            "[RigidBodyFactory] Vértices e índices são obrigatórios para Trimesh.",
          );
        }

        assertTrimesh(config.vertices, config.indices);

        desc = RAPIER.ColliderDesc.trimesh(
          config.vertices,
          config.indices,
        );
        break;
      }

      default:
        throw new RangeError(
          `ColliderShapeType inválido: ${String(config.shapeType)}.`,
        );
    }

    if (config.friction !== undefined) {
      assertNonNegative(config.friction, "friction");
      desc.setFriction(config.friction);
    }

    if (config.restitution !== undefined) {
      // Valores > 1 são aceitos (adicionam energia: trampolins/bumpers).
      assertNonNegative(config.restitution, "restitution");
      desc.setRestitution(config.restitution);
    }

    if (config.isSensor === true) {
      desc.setSensor(true);
    }

    if (config.density !== undefined) {
      assertPositive(config.density, "density");
      desc.setDensity(config.density);
    }

    if (config.offset !== undefined) {
      assertVector3(config.offset, "offset");

      desc.setTranslation(
        config.offset.x,
        config.offset.y,
        config.offset.z,
      );
    }

    if (config.rotationOffset !== undefined) {
      assertQuaternion(config.rotationOffset, "rotationOffset");

      desc.setRotation(
        new RAPIER.Quaternion(
          config.rotationOffset.x,
          config.rotationOffset.y,
          config.rotationOffset.z,
          config.rotationOffset.w,
        ),
      );
    }

    if (config.collisionGroups !== undefined) {
      desc.setCollisionGroups(
        toInteractionGroups(config.collisionGroups),
      );
    }

    let activeEvents =
      RAPIER.ActiveEvents.COLLISION_EVENTS;

    if (config.contactForceThreshold !== undefined) {
      assertNonNegative(
        config.contactForceThreshold,
        "contactForceThreshold",
      );

      desc.setContactForceEventThreshold(
        config.contactForceThreshold,
      );

      activeEvents |=
        RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS;
    }

    desc.setActiveEvents(activeEvents);

    // Por padrão o Rapier ignora pares fixed/kinematic. Sensores devem
    // detectar QUALQUER corpo (ex.: plataforma kinematic entrando num trigger
    // preso a um corpo fixed). Pares fixed-fixed continuam ignorados para que
    // um trigger estático não dispare contra o chão estático.
    if (config.isSensor === true) {
      desc.setActiveCollisionTypes(
        RAPIER.ActiveCollisionTypes.DEFAULT |
          RAPIER.ActiveCollisionTypes.KINEMATIC_FIXED |
          RAPIER.ActiveCollisionTypes.KINEMATIC_KINEMATIC,
      );
    }

    return desc;
  }

  public static createQueryShape(
    config: QueryShapeDescriptor,
  ): RAPIER.Shape {
    switch (config.shapeType) {
      case "box": {
        const [halfX, halfY, halfZ] =
          readHalfExtents(config);

        return new RAPIER.Cuboid(halfX, halfY, halfZ);
      }

      case "sphere":
        return new RAPIER.Ball(
          readRadius(config, 0.5),
        );

      case "capsule": {
        const halfHeight =
          config.halfHeight ?? 0.5;

        assertNonNegative(halfHeight, "halfHeight");

        return new RAPIER.Capsule(
          halfHeight,
          readRadius(config, 0.25),
        );
      }

      case "cylinder":
        return new RAPIER.Cylinder(
          readHalfHeight(config, 0.5),
          readRadius(config, 0.5),
        );

      case "cone":
        return new RAPIER.Cone(
          readHalfHeight(config, 0.5),
          readRadius(config, 0.5),
        );

      default:
        throw new RangeError(
          `shapeType de consulta inválido: ${String((config as { shapeType: unknown }).shapeType)}.`,
        );
    }
  }
}
