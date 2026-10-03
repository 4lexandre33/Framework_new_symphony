import RAPIER from "@dimforge/rapier3d-compat";
import type { RigidBodyDescriptor, ColliderDescriptor } from "../../contracts/physics/types";

export class RigidBodyFactory {
  public static createRigidBodyDesc(config: RigidBodyDescriptor): RAPIER.RigidBodyDesc {
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
        desc = RAPIER.RigidBodyDesc.dynamic();
    }

    if (config.position) {
      desc.setTranslation(config.position.x, config.position.y, config.position.z);
    }

    if (config.rotation) {
      desc.setRotation(new RAPIER.Quaternion(config.rotation.x, config.rotation.y, config.rotation.z, config.rotation.w));
    }

    if (config.linearDamping !== undefined) {
      desc.setLinearDamping(config.linearDamping);
    }

    if (config.angularDamping !== undefined) {
      desc.setAngularDamping(config.angularDamping);
    }

    if (config.gravityScale !== undefined) {
      desc.setGravityScale(config.gravityScale);
    }

    if (config.canSleep !== undefined) {
      desc.setCanSleep(config.canSleep);
    }

    return desc;
  }

  public static createColliderDesc(config: ColliderDescriptor): RAPIER.ColliderDesc {
    let desc: RAPIER.ColliderDesc;

    switch (config.shapeType) {
      case "box": {
        const h = config.halfExtents || { x: 0.5, y: 0.5, z: 0.5 };
        desc = RAPIER.ColliderDesc.cuboid(h.x, h.y, h.z);
        break;
      }
      case "sphere": {
        const r = config.radius !== undefined ? config.radius : 0.5;
        desc = RAPIER.ColliderDesc.ball(r);
        break;
      }
      case "capsule": {
        const halfHeight = config.halfHeight !== undefined ? config.halfHeight : 0.5;
        const radius = config.radius !== undefined ? config.radius : 0.25;
        desc = RAPIER.ColliderDesc.capsule(halfHeight, radius);
        break;
      }
      case "trimesh": {
        if (!config.vertices || !config.indices) {
          throw new Error("[RigidBodyFactory] Vértices e Índices são obrigatórios para geometrias Trimesh.");
        }
        desc = RAPIER.ColliderDesc.trimesh(config.vertices, config.indices);
        break;
      }
      default:
        desc = RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5);
    }

    if (config.friction !== undefined) {
      desc.setFriction(config.friction);
    }

    if (config.restitution !== undefined) {
      desc.setRestitution(config.restitution);
    }

    if (config.isSensor) {
      desc.setSensor(true);
    }

    if (config.density !== undefined) {
      desc.setDensity(config.density);
    }

    desc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    return desc;
  }
}