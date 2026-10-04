import RAPIER from "@dimforge/rapier3d-compat";

import type {
  RigidBodyDescriptor,
  ColliderDescriptor,
  Vector3DTO,
  QuaternionDTO,
  RaycastRequest,
  RaycastHit,
  PhysicsStats,
} from "../../../contracts/physics/types";

import { RigidBodyFactory } from "./RigidBodyFactory";
import { RaycasterQueries } from "./RaycasterQueries";
import { CollisionEventManager } from "./CollisionEventManager";

export class PhysicsWorld {
  private world: RAPIER.World | null = null;

  private eventQueue: RAPIER.EventQueue | null = null;

  private readonly entityToBodyMap =
    new Map<string, RAPIER.RigidBody>();

  private readonly handleToEntityMap =
    new Map<number, string>();

  private lastStepTimeMs = 0;

  private isInitialized = false;

  private readonly scratchPosition: Vector3DTO = {
    x: 0,
    y: 0,
    z: 0,
  };

  private readonly scratchRotation: QuaternionDTO = {
    x: 0,
    y: 0,
    z: 0,
    w: 1,
  };

  public async initialize(): Promise<boolean> {
    if (this.isInitialized) {
      return true;
    }

    try {
      await RAPIER.init();

      const gravity =
        new RAPIER.Vector3(
          0.0,
          -9.81,
          0.0,
        );

      this.world =
        new RAPIER.World(
          gravity,
        );

      this.eventQueue =
        new RAPIER.EventQueue(
          true,
        );

      this.isInitialized =
        true;

      console.log(
        "[PhysicsWorld] ✅ Motor físico Rapier WASM inicializado com sucesso.",
      );

      return true;
    } catch (error: unknown) {
      console.error(
        "[PhysicsWorld] ❌ Falha ao inicializar o Rapier WASM:",
        error,
      );

      return false;
    }
  }

  public step(
    deltaTimeSeconds: number,
    eventManager?: CollisionEventManager,
  ): void {
    if (
      !this.world ||
      !this.isInitialized
    ) {
      return;
    }

    const startTime =
      performance.now();

    this.world.timestep =
      Math.min(
        deltaTimeSeconds,
        0.033,
      );

    if (
      this.eventQueue &&
      eventManager
    ) {
      this.world.step(
        this.eventQueue,
      );

      eventManager.processEvents(
        this.eventQueue,
        this.handleToEntityMap,
      );

      this.eventQueue.clear();
    } else {
      this.world.step();
    }

    this.lastStepTimeMs =
      performance.now() -
      startTime;
  }

  public createBody(
    entityId: string,
    bodyDesc: RigidBodyDescriptor,
    colliderDesc?: ColliderDescriptor,
  ): boolean {
    if (!this.world) {
      return false;
    }

    if (
      this.entityToBodyMap.has(
        entityId,
      )
    ) {
      this.removeBody(
        entityId,
      );
    }

    const rapierBodyDesc =
      RigidBodyFactory
        .createRigidBodyDesc(
          bodyDesc,
        );

    const body =
      this.world
        .createRigidBody(
          rapierBodyDesc,
        );

    if (colliderDesc) {
      const rapierColliderDesc =
        RigidBodyFactory
          .createColliderDesc(
            colliderDesc,
          );

      const collider =
        this.world
          .createCollider(
            rapierColliderDesc,
            body,
          );

      this.handleToEntityMap.set(
        collider.handle,
        entityId,
      );
    }

    this.entityToBodyMap.set(
      entityId,
      body,
    );

    return true;
  }

  public removeBody(
    entityId: string,
  ): boolean {
    if (!this.world) {
      return false;
    }

    const body =
      this.entityToBodyMap.get(
        entityId,
      );

    if (!body) {
      return false;
    }

    const colliderCount =
      body.numColliders();

    for (
      let index = 0;
      index < colliderCount;
      index += 1
    ) {
      const collider =
        body.collider(
          index,
        );

      this.handleToEntityMap.delete(
        collider.handle,
      );
    }

    this.world.removeRigidBody(
      body,
    );

    this.entityToBodyMap.delete(
      entityId,
    );

    return true;
  }

  public applyImpulse(
    entityId: string,
    impulse: Vector3DTO,
  ): boolean {
    const body =
      this.entityToBodyMap.get(
        entityId,
      );

    if (
      !body ||
      body.bodyType() !==
        RAPIER.RigidBodyType.Dynamic
    ) {
      return false;
    }

    body.applyImpulse(
      new RAPIER.Vector3(
        impulse.x,
        impulse.y,
        impulse.z,
      ),
      true,
    );

    return true;
  }

  public applyForce(
    entityId: string,
    force: Vector3DTO,
  ): boolean {
    const body =
      this.entityToBodyMap.get(
        entityId,
      );

    if (
      !body ||
      body.bodyType() !==
        RAPIER.RigidBodyType.Dynamic
    ) {
      return false;
    }

    body.addForce(
      new RAPIER.Vector3(
        force.x,
        force.y,
        force.z,
      ),
      true,
    );

    return true;
  }

  public castRay(
    request: RaycastRequest,
  ): RaycastHit {
    if (!this.world) {
      return {
        hit: false,
        distance: 0,

        point: {
          x: 0,
          y: 0,
          z: 0,
        },

        normal: {
          x: 0,
          y: 0,
          z: 0,
        },
      };
    }

    return RaycasterQueries
      .castRay(
        this.world,
        this.handleToEntityMap,
        request,
      );
  }

  public getBodyTransform(
    entityId: string,
  ): {
    position: Vector3DTO;
    rotation: QuaternionDTO;
  } | null {
    const body =
      this.entityToBodyMap.get(
        entityId,
      );

    if (!body) {
      return null;
    }

    const translation =
      body.translation();

    const rotation =
      body.rotation();

    (
      this.scratchPosition as {
        x: number;
        y: number;
        z: number;
      }
    ).x =
      translation.x;

    (
      this.scratchPosition as {
        x: number;
        y: number;
        z: number;
      }
    ).y =
      translation.y;

    (
      this.scratchPosition as {
        x: number;
        y: number;
        z: number;
      }
    ).z =
      translation.z;

    (
      this.scratchRotation as {
        x: number;
        y: number;
        z: number;
        w: number;
      }
    ).x =
      rotation.x;

    (
      this.scratchRotation as {
        x: number;
        y: number;
        z: number;
        w: number;
      }
    ).y =
      rotation.y;

    (
      this.scratchRotation as {
        x: number;
        y: number;
        z: number;
        w: number;
      }
    ).z =
      rotation.z;

    (
      this.scratchRotation as {
        x: number;
        y: number;
        z: number;
        w: number;
      }
    ).w =
      rotation.w;

    return {
      position:
        this.scratchPosition,

      rotation:
        this.scratchRotation,
    };
  }

  public syncMeshTransform(
    entityId: string,
    targetMesh: {
      position: Vector3DTO;
      quaternion: QuaternionDTO;
    },
  ): boolean {
    const transform =
      this.getBodyTransform(
        entityId,
      );

    if (!transform) {
      return false;
    }

    const mutablePosition =
      targetMesh.position as {
        x: number;
        y: number;
        z: number;
      };

    const mutableQuaternion =
      targetMesh.quaternion as {
        x: number;
        y: number;
        z: number;
        w: number;
      };

    mutablePosition.x =
      transform.position.x;

    mutablePosition.y =
      transform.position.y;

    mutablePosition.z =
      transform.position.z;

    mutableQuaternion.x =
      transform.rotation.x;

    mutableQuaternion.y =
      transform.rotation.y;

    mutableQuaternion.z =
      transform.rotation.z;

    mutableQuaternion.w =
      transform.rotation.w;

    return true;
  }

  public setGravity(
    gravity: Vector3DTO,
  ): void {
    if (!this.world) {
      return;
    }

    this.world.gravity =
      new RAPIER.Vector3(
        gravity.x,
        gravity.y,
        gravity.z,
      );
  }

  public getStats(): PhysicsStats {
    return {
      rigidBodyCount:
        this.entityToBodyMap.size,

      colliderCount:
        this.world
          ? this.world.colliders.len()
          : 0,

      stepTimeMs:
        this.lastStepTimeMs,

      isWasmLoaded:
        this.isInitialized,
    };
  }

  public dispose(): void {
    this.entityToBodyMap.clear();

    this.handleToEntityMap.clear();

    if (this.world) {
      this.world.free();

      this.world =
        null;
    }

    this.eventQueue =
      null;

    this.lastStepTimeMs =
      0;

    this.isInitialized =
      false;
  }
}