import RAPIER from "@dimforge/rapier3d-compat";

import type {
  ColliderDescriptor,
  PhysicsStats,
  QuaternionDTO,
  RaycastHit,
  RaycastRequest,
  RigidBodyDescriptor,
  Vector3DTO,
} from "../../../contracts/physics/types";

import type { CollisionEventManager } from "./CollisionEventManager";
import { RaycasterQueries } from "./RaycasterQueries";
import { RigidBodyFactory } from "./RigidBodyFactory";

export const PHYSICS_MIN_STEP_SECONDS =
  1 /
  240;

export const PHYSICS_MAX_STEP_SECONDS =
  1;

interface MutableVector3DTO {
  x: number;
  y: number;
  z: number;
}

interface MutableQuaternionDTO {
  x: number;
  y: number;
  z: number;
  w: number;
}

interface MutableTransformSnapshot {
  readonly position:
    MutableVector3DTO;
  readonly rotation:
    MutableQuaternionDTO;
}

interface MutablePhysicsStats {
  rigidBodyCount: number;
  colliderCount: number;
  stepTimeMs: number;
  isWasmLoaded: boolean;
}

function defaultNowMs(): number {
  const clock =
    globalThis.performance;

  return clock !==
    undefined
    ? clock.now()
    : Date.now();
}

function assertFiniteVector(
  value: Vector3DTO,
  label: string,
): void {
  if (
    !Number.isFinite(
      value.x,
    ) ||
    !Number.isFinite(
      value.y,
    ) ||
    !Number.isFinite(
      value.z,
    )
  ) {
    throw new RangeError(
      `${label} precisa conter componentes finitos.`,
    );
  }
}

function assertStepDelta(
  deltaTimeSeconds: number,
): void {
  if (
    !Number.isFinite(
      deltaTimeSeconds,
    ) ||
    deltaTimeSeconds <
      PHYSICS_MIN_STEP_SECONDS ||
    deltaTimeSeconds >
      PHYSICS_MAX_STEP_SECONDS
  ) {
    throw new RangeError(
      `physics step precisa estar entre ${String(PHYSICS_MIN_STEP_SECONDS)} e ${String(PHYSICS_MAX_STEP_SECONDS)} segundos.`,
    );
  }
}

function createTransformSnapshot():
  MutableTransformSnapshot {
  return {
    position: {
      x:
        0,
      y:
        0,
      z:
        0,
    },
    rotation: {
      x:
        0,
      y:
        0,
      z:
        0,
      w:
        1,
    },
  };
}

export class PhysicsWorld {
  private world:
    RAPIER.World |
    null = null;

  private eventQueue:
    RAPIER.EventQueue |
    null = null;

  private readonly entityToBodyMap =
    new Map<
      string,
      RAPIER.RigidBody
    >();

  private readonly handleToEntityMap =
    new Map<
      number,
      string
    >();

  private readonly handleToSensorMap =
    new Map<
      number,
      boolean
    >();

  private readonly transformCache =
    new Map<
      string,
      MutableTransformSnapshot
    >();

  private readonly stats:
    MutablePhysicsStats = {
      rigidBodyCount:
        0,
      colliderCount:
        0,
      stepTimeMs:
        0,
      isWasmLoaded:
        false,
    };

  private isInitialized =
    false;

  private disposed =
    false;

  public constructor(
    private readonly nowMs:
      () => number =
        defaultNowMs,
  ) {}

  public async initialize():
    Promise<boolean> {
    if (
      this.disposed
    ) {
      return false;
    }

    if (
      this.isInitialized
    ) {
      return true;
    }

    try {
      await RAPIER.init();

      this.world =
        new RAPIER.World(
          new RAPIER.Vector3(
            0,
            -9.81,
            0,
          ),
        );

      this.eventQueue =
        new RAPIER.EventQueue(
          true,
        );

      this.isInitialized =
        true;

      this.stats.isWasmLoaded =
        true;

      return true;
    } catch (
      error:
        unknown
    ) {
      console.error(
        "[PhysicsWorld] Falha ao inicializar Rapier WASM:",
        error,
      );

      this.world =
        null;

      this.eventQueue =
        null;

      this.isInitialized =
        false;

      this.stats.isWasmLoaded =
        false;

      return false;
    }
  }

  public step(
    deltaTimeSeconds: number,
    eventManager?:
      CollisionEventManager,
  ): void {
    if (
      this.world ===
        null ||
      !this.isInitialized ||
      this.disposed
    ) {
      return;
    }

    assertStepDelta(
      deltaTimeSeconds,
    );

    const startTimeMs =
      this.nowMs();

    // O game.loop da Stage 75 já entrega um tick fixo.
    // Não clampa nem re-acumula aqui: Rapier recebe exatamente o mesmo dt.
    this.world.timestep =
      deltaTimeSeconds;

    if (
      this.eventQueue !==
        null &&
      eventManager !==
        undefined
    ) {
      this.world.step(
        this.eventQueue,
      );

      eventManager.processEvents(
        this.eventQueue,
        this.handleToEntityMap,
        this.handleToSensorMap,
      );

      this.eventQueue.clear();
    } else {
      this.world.step();
    }

    const elapsed =
      this.nowMs() -
      startTimeMs;

    this.stats.stepTimeMs =
      Number.isFinite(
        elapsed,
      ) &&
      elapsed >=
        0
        ? elapsed
        : 0;
  }

  public createBody(
    entityId: string,
    bodyDesc:
      RigidBodyDescriptor,
    colliderDesc?:
      ColliderDescriptor,
  ): boolean {
    if (
      this.world ===
        null ||
      this.disposed
    ) {
      return false;
    }

    if (
      entityId.trim()
        .length ===
      0
    ) {
      throw new RangeError(
        "entityId não pode ser vazio.",
      );
    }

    // Valide todos os descriptors antes de tocar o world. Uma tentativa de
    // replacement inválida não pode destruir o body antigo.
    const rapierBodyDesc =
      RigidBodyFactory
        .createRigidBodyDesc(
          bodyDesc,
        );

    const rapierColliderDesc =
      colliderDesc ===
        undefined
        ? null
        : RigidBodyFactory
            .createColliderDesc(
              colliderDesc,
            );

    if (
      this.entityToBodyMap.has(
        entityId,
      )
    ) {
      this.removeBody(
        entityId,
      );
    }

    const body =
      this.world.createRigidBody(
        rapierBodyDesc,
      );

    try {
      if (
        rapierColliderDesc !==
          null &&
        colliderDesc !==
          undefined
      ) {
        const collider =
          this.world.createCollider(
            rapierColliderDesc,
            body,
          );

        this.handleToEntityMap.set(
          collider.handle,
          entityId,
        );

        this.handleToSensorMap.set(
          collider.handle,
          colliderDesc.isSensor ===
            true,
        );
      }
    } catch (error) {
      this.world.removeRigidBody(
        body,
      );

      throw error;
    }

    this.entityToBodyMap.set(
      entityId,
      body,
    );

    this.transformCache.set(
      entityId,
      createTransformSnapshot(),
    );

    this.refreshStats();

    return true;
  }

  public removeBody(
    entityId: string,
  ): boolean {
    if (
      this.world ===
        null ||
      this.disposed
    ) {
      return false;
    }

    const body =
      this.entityToBodyMap.get(
        entityId,
      );

    if (
      body ===
      undefined
    ) {
      return false;
    }

    const colliderCount =
      body.numColliders();

    for (
      let index =
        0;
      index <
      colliderCount;
      index +=
        1
    ) {
      const collider =
        body.collider(
          index,
        );

      this.handleToEntityMap.delete(
        collider.handle,
      );

      this.handleToSensorMap.delete(
        collider.handle,
      );
    }

    this.world.removeRigidBody(
      body,
    );

    this.entityToBodyMap.delete(
      entityId,
    );

    this.transformCache.delete(
      entityId,
    );

    this.refreshStats();

    return true;
  }

  public applyImpulse(
    entityId: string,
    impulse:
      Vector3DTO,
  ): boolean {
    const body =
      this.entityToBodyMap.get(
        entityId,
      );

    if (
      body ===
        undefined ||
      body.bodyType() !==
        RAPIER.RigidBodyType
          .Dynamic
    ) {
      return false;
    }

    assertFiniteVector(
      impulse,
      "impulse",
    );

    body.applyImpulse(
      impulse,
      true,
    );

    return true;
  }

  public applyForce(
    entityId: string,
    force:
      Vector3DTO,
  ): boolean {
    const body =
      this.entityToBodyMap.get(
        entityId,
      );

    if (
      body ===
        undefined ||
      body.bodyType() !==
        RAPIER.RigidBodyType
          .Dynamic
    ) {
      return false;
    }

    assertFiniteVector(
      force,
      "force",
    );

    body.addForce(
      force,
      true,
    );

    return true;
  }

  public castRay(
    request:
      RaycastRequest,
  ): RaycastHit {
    if (
      this.world ===
        null ||
      this.disposed
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
    position:
      Vector3DTO;
    rotation:
      QuaternionDTO;
  } | null {
    const body =
      this.entityToBodyMap.get(
        entityId,
      );

    const snapshot =
      this.transformCache.get(
        entityId,
      );

    if (
      body ===
        undefined ||
      snapshot ===
        undefined
    ) {
      return null;
    }

    const translation =
      body.translation();

    const rotation =
      body.rotation();

    snapshot.position.x =
      translation.x;

    snapshot.position.y =
      translation.y;

    snapshot.position.z =
      translation.z;

    snapshot.rotation.x =
      rotation.x;

    snapshot.rotation.y =
      rotation.y;

    snapshot.rotation.z =
      rotation.z;

    snapshot.rotation.w =
      rotation.w;

    return snapshot;
  }

  public syncMeshTransform(
    entityId: string,
    targetMesh: {
      position:
        Vector3DTO;
      quaternion:
        QuaternionDTO;
    },
  ): boolean {
    const body =
      this.entityToBodyMap.get(
        entityId,
      );

    if (
      body ===
      undefined
    ) {
      return false;
    }

    const translation =
      body.translation();

    const rotation =
      body.rotation();

    const mutablePosition =
      targetMesh.position as
        MutableVector3DTO;

    const mutableQuaternion =
      targetMesh.quaternion as
        MutableQuaternionDTO;

    mutablePosition.x =
      translation.x;

    mutablePosition.y =
      translation.y;

    mutablePosition.z =
      translation.z;

    mutableQuaternion.x =
      rotation.x;

    mutableQuaternion.y =
      rotation.y;

    mutableQuaternion.z =
      rotation.z;

    mutableQuaternion.w =
      rotation.w;

    return true;
  }

  public setGravity(
    gravity:
      Vector3DTO,
  ): void {
    if (
      this.world ===
        null ||
      this.disposed
    ) {
      return;
    }

    assertFiniteVector(
      gravity,
      "gravity",
    );

    this.world.gravity =
      new RAPIER.Vector3(
        gravity.x,
        gravity.y,
        gravity.z,
      );
  }

  public getStats():
    PhysicsStats {
    this.refreshStats();

    return this.stats;
  }

  public dispose(): void {
    if (
      this.disposed
    ) {
      return;
    }

    this.disposed =
      true;

    this.entityToBodyMap.clear();
    this.handleToEntityMap.clear();
    this.handleToSensorMap.clear();
    this.transformCache.clear();

    if (
      this.eventQueue !==
      null
    ) {
      this.eventQueue.free();
      this.eventQueue =
        null;
    }

    if (
      this.world !==
      null
    ) {
      this.world.free();
      this.world =
        null;
    }

    this.lastResetStats();
    this.isInitialized =
      false;
  }

  private refreshStats(): void {
    this.stats.rigidBodyCount =
      this.entityToBodyMap.size;

    this.stats.colliderCount =
      this.world ===
        null
        ? 0
        : this.world.colliders
            .len();

    this.stats.isWasmLoaded =
      this.isInitialized &&
      !this.disposed;
  }

  private lastResetStats(): void {
    this.stats.rigidBodyCount =
      0;

    this.stats.colliderCount =
      0;

    this.stats.stepTimeMs =
      0;

    this.stats.isWasmLoaded =
      false;
  }
}
