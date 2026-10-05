import RAPIER from "@dimforge/rapier3d-compat";

import type {
  ColliderDescriptor,
  QuaternionDTO,
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

function assertVector3(
  value: Vector3DTO,
  label: string,
): void {
  assertFinite(
    value.x,
    `${label}.x`,
  );

  assertFinite(
    value.y,
    `${label}.y`,
  );

  assertFinite(
    value.z,
    `${label}.z`,
  );
}

function assertQuaternion(
  value: QuaternionDTO,
): void {
  assertFinite(
    value.x,
    "rotation.x",
  );

  assertFinite(
    value.y,
    "rotation.y",
  );

  assertFinite(
    value.z,
    "rotation.z",
  );

  assertFinite(
    value.w,
    "rotation.w",
  );

  const normSquared =
    value.x *
      value.x +
    value.y *
      value.y +
    value.z *
      value.z +
    value.w *
      value.w;

  if (
    normSquared <=
    Number.EPSILON
  ) {
    throw new RangeError(
      "rotation não pode ser um quaternion de norma zero.",
    );
  }
}

function assertTrimesh(
  vertices: Float32Array,
  indices: Uint32Array,
): void {
  if (
    vertices.length <
      9 ||
    vertices.length %
      3 !==
      0
  ) {
    throw new RangeError(
      "Trimesh.vertices precisa conter ao menos 3 vértices e ter tamanho múltiplo de 3.",
    );
  }

  if (
    indices.length <
      3 ||
    indices.length %
      3 !==
      0
  ) {
    throw new RangeError(
      "Trimesh.indices precisa conter ao menos um triângulo e ter tamanho múltiplo de 3.",
    );
  }

  const vertexCount =
    vertices.length /
    3;

  for (
    let index =
      0;
    index <
    vertices.length;
    index +=
      1
  ) {
    assertFinite(
      vertices[index] ??
        Number.NaN,
      `vertices[${String(index)}]`,
    );
  }

  for (
    let index =
      0;
    index <
    indices.length;
    index +=
      1
  ) {
    const vertexIndex =
      indices[index];

    if (
      vertexIndex ===
        undefined ||
      vertexIndex >=
        vertexCount
    ) {
      throw new RangeError(
        `indices[${String(index)}] referencia vértice inexistente.`,
      );
    }
  }
}

export class RigidBodyFactory {
  public static createRigidBodyDesc(
    config: RigidBodyDescriptor,
  ): RAPIER.RigidBodyDesc {
    let desc:
      RAPIER.RigidBodyDesc;

    switch (
      config.bodyType
    ) {
      case "dynamic":
        desc =
          RAPIER.RigidBodyDesc
            .dynamic();
        break;

      case "fixed":
        desc =
          RAPIER.RigidBodyDesc
            .fixed();
        break;

      case "kinematicPositionBased":
        desc =
          RAPIER.RigidBodyDesc
            .kinematicPositionBased();
        break;

      case "kinematicVelocityBased":
        desc =
          RAPIER.RigidBodyDesc
            .kinematicVelocityBased();
        break;

      default:
        throw new RangeError(
          `RigidBodyType inválido: ${String(config.bodyType)}.`,
        );
    }

    if (
      config.position !==
      undefined
    ) {
      assertVector3(
        config.position,
        "position",
      );

      desc.setTranslation(
        config.position.x,
        config.position.y,
        config.position.z,
      );
    }

    if (
      config.rotation !==
      undefined
    ) {
      assertQuaternion(
        config.rotation,
      );

      desc.setRotation(
        new RAPIER.Quaternion(
          config.rotation.x,
          config.rotation.y,
          config.rotation.z,
          config.rotation.w,
        ),
      );
    }

    if (
      config.linearDamping !==
      undefined
    ) {
      assertNonNegative(
        config.linearDamping,
        "linearDamping",
      );

      desc.setLinearDamping(
        config.linearDamping,
      );
    }

    if (
      config.angularDamping !==
      undefined
    ) {
      assertNonNegative(
        config.angularDamping,
        "angularDamping",
      );

      desc.setAngularDamping(
        config.angularDamping,
      );
    }

    if (
      config.gravityScale !==
      undefined
    ) {
      assertFinite(
        config.gravityScale,
        "gravityScale",
      );

      desc.setGravityScale(
        config.gravityScale,
      );
    }

    if (
      config.canSleep !==
      undefined
    ) {
      desc.setCanSleep(
        config.canSleep,
      );
    }

    return desc;
  }

  public static createColliderDesc(
    config: ColliderDescriptor,
  ): RAPIER.ColliderDesc {
    let desc:
      RAPIER.ColliderDesc;

    switch (
      config.shapeType
    ) {
      case "box": {
        const halfExtents =
          config.halfExtents;

        const halfX =
          halfExtents?.x ??
          0.5;

        const halfY =
          halfExtents?.y ??
          0.5;

        const halfZ =
          halfExtents?.z ??
          0.5;

        assertPositive(
          halfX,
          "halfExtents.x",
        );

        assertPositive(
          halfY,
          "halfExtents.y",
        );

        assertPositive(
          halfZ,
          "halfExtents.z",
        );

        desc =
          RAPIER.ColliderDesc
            .cuboid(
              halfX,
              halfY,
              halfZ,
            );

        break;
      }

      case "sphere": {
        const radius =
          config.radius ??
          0.5;

        assertPositive(
          radius,
          "radius",
        );

        desc =
          RAPIER.ColliderDesc
            .ball(
              radius,
            );

        break;
      }

      case "capsule": {
        const halfHeight =
          config.halfHeight ??
          0.5;

        const radius =
          config.radius ??
          0.25;

        assertNonNegative(
          halfHeight,
          "halfHeight",
        );

        assertPositive(
          radius,
          "radius",
        );

        desc =
          RAPIER.ColliderDesc
            .capsule(
              halfHeight,
              radius,
            );

        break;
      }

      case "trimesh": {
        if (
          config.vertices ===
            undefined ||
          config.indices ===
            undefined
        ) {
          throw new Error(
            "[RigidBodyFactory] Vértices e índices são obrigatórios para Trimesh.",
          );
        }

        assertTrimesh(
          config.vertices,
          config.indices,
        );

        desc =
          RAPIER.ColliderDesc
            .trimesh(
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

    if (
      config.friction !==
      undefined
    ) {
      assertNonNegative(
        config.friction,
        "friction",
      );

      desc.setFriction(
        config.friction,
      );
    }

    if (
      config.restitution !==
      undefined
    ) {
      assertNonNegative(
        config.restitution,
        "restitution",
      );

      if (
        config.restitution >
        1
      ) {
        throw new RangeError(
          "restitution precisa estar entre 0 e 1.",
        );
      }

      desc.setRestitution(
        config.restitution,
      );
    }

    if (
      config.isSensor ===
      true
    ) {
      desc.setSensor(
        true,
      );
    }

    if (
      config.density !==
      undefined
    ) {
      assertPositive(
        config.density,
        "density",
      );

      desc.setDensity(
        config.density,
      );
    }

    desc.setActiveEvents(
      RAPIER.ActiveEvents
        .COLLISION_EVENTS,
    );

    return desc;
  }
}
