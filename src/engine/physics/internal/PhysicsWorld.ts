import RAPIER from "@dimforge/rapier3d-compat";

import type {
  AxisFlagsDTO,
  BodyTransformDTO,
  ColliderDescriptor,
  CollisionGroupsDTO,
  JointDescriptor,
  JointMotorDTO,
  KinematicTargetDTO,
  MutableBodyTransformDTO,
  OverlapQueryRequest,
  PhysicsStats,
  QuaternionDTO,
  RaycastHit,
  RaycastRequest,
  RigidBodyDescriptor,
  ShapeCastHit,
  ShapeCastRequest,
  Vector3DTO,
} from "../../../contracts/physics/types";

import type { CollisionEventManager } from "./CollisionEventManager";
import { RaycasterQueries } from "./RaycasterQueries";
import {
  RigidBodyFactory,
  assertQuaternion,
  assertVector3,
  toInteractionGroups,
} from "./RigidBodyFactory";

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

interface MutablePhysicsStats {
  rigidBodyCount: number;
  colliderCount: number;
  stepTimeMs: number;
  isWasmLoaded: boolean;
}

interface JointRecord {
  readonly joint: RAPIER.ImpulseJoint;
  readonly type: JointDescriptor["type"];
  readonly entityIdA: string;
  readonly entityIdB: string;
}

const ZERO_VECTOR: Vector3DTO =
  Object.freeze({
    x: 0,
    y: 0,
    z: 0,
  });

const IDENTITY_ROTATION: QuaternionDTO =
  Object.freeze({
    x: 0,
    y: 0,
    z: 0,
    w: 1,
  });

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

function toRapierVector(
  value: Vector3DTO,
): RAPIER.Vector3 {
  return new RAPIER.Vector3(
    value.x,
    value.y,
    value.z,
  );
}

function toRapierQuaternion(
  value: QuaternionDTO,
): RAPIER.Quaternion {
  return new RAPIER.Quaternion(
    value.x,
    value.y,
    value.z,
    value.w,
  );
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

  private readonly joints =
    new Map<
      string,
      JointRecord
    >();

  /** Scratch reutilizado em removeBody (handles dos colliders do corpo). */
  private readonly removalHandles =
    new Set<number>();

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

  private attachedEventManager:
    CollisionEventManager |
    null = null;

  /**
   * true quando corpos/colliders foram criados, removidos ou teleportados
   * desde o último step: consultas (raycast, shape-cast, overlap) atualizam
   * o query pipeline antes de executar, para enxergar o estado atual.
   */
  private queriesDirty =
    false;

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

  /**
   * Gerenciador usado para emitir `collision-exit`/`trigger-exit` quando um
   * corpo é removido fora do step. O PhysicsService anexa o seu.
   */
  public attachEventManager(
    eventManager:
      CollisionEventManager |
      null,
  ): void {
    this.attachedEventManager =
      eventManager;
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

    // world.step atualiza o query pipeline ao final.
    this.queriesDirty =
      false;

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

    this.assertEntityId(
      entityId,
    );

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
        this.attachCollider(
          entityId,
          body,
          rapierColliderDesc,
          colliderDesc.isSensor === true,
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

    this.queriesDirty =
      true;

    this.refreshStats();

    return true;
  }

  public addCollider(
    entityId: string,
    colliderDesc:
      ColliderDescriptor,
  ): boolean {
    const body =
      this.getBody(
        entityId,
      );

    if (
      body ===
      undefined
    ) {
      return false;
    }

    const rapierColliderDesc =
      RigidBodyFactory
        .createColliderDesc(
          colliderDesc,
        );

    this.attachCollider(
      entityId,
      body,
      rapierColliderDesc,
      colliderDesc.isSensor === true,
    );

    this.queriesDirty =
      true;

    this.refreshStats();

    return true;
  }

  public hasBody(
    entityId: string,
  ): boolean {
    return this.getBody(
      entityId,
    ) !==
      undefined;
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

    this.removalHandles.clear();

    for (
      let index =
        0;
      index <
      colliderCount;
      index +=
        1
    ) {
      this.removalHandles.add(
        body.collider(
          index,
        ).handle,
      );
    }

    // Contatos ativos deste corpo terminam agora: o Rapier só reportaria o
    // fim no próximo step, quando os handles já não mapeiam mais a entidade.
    if (
      this.attachedEventManager !==
      null
    ) {
      this.attachedEventManager
        .emitExitsForColliders(
          this.removalHandles,
        );
    }

    for (
      const handle of
      this.removalHandles
    ) {
      this.handleToEntityMap.delete(
        handle,
      );

      this.handleToSensorMap.delete(
        handle,
      );
    }

    this.removalHandles.clear();

    // O Rapier remove automaticamente os joints ligados ao corpo.
    for (
      const [
        jointId,
        record,
      ] of
      this.joints
    ) {
      if (
        record.entityIdA ===
          entityId ||
        record.entityIdB ===
          entityId
      ) {
        this.joints.delete(
          jointId,
        );
      }
    }

    this.world.removeRigidBody(
      body,
    );

    this.entityToBodyMap.delete(
      entityId,
    );

    this.queriesDirty =
      true;

    this.refreshStats();

    return true;
  }

  public applyImpulse(
    entityId: string,
    impulse:
      Vector3DTO,
  ): boolean {
    const body =
      this.getDynamicBody(
        entityId,
      );

    if (
      body ===
      undefined
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
      this.getDynamicBody(
        entityId,
      );

    if (
      body ===
      undefined
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

  public applyTorqueImpulse(
    entityId: string,
    torqueImpulse:
      Vector3DTO,
  ): boolean {
    const body =
      this.getDynamicBody(
        entityId,
      );

    if (
      body ===
      undefined
    ) {
      return false;
    }

    assertFiniteVector(
      torqueImpulse,
      "torqueImpulse",
    );

    body.applyTorqueImpulse(
      torqueImpulse,
      true,
    );

    return true;
  }

  public resetForces(
    entityId: string,
  ): boolean {
    const body =
      this.getDynamicBody(
        entityId,
      );

    if (
      body ===
      undefined
    ) {
      return false;
    }

    body.resetForces(
      true,
    );

    body.resetTorques(
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

    this.refreshQueriesIfDirty();

    return RaycasterQueries
      .castRay(
        this.world,
        this.handleToEntityMap,
        request,
        this.entityToBodyMap,
      );
  }

  public castShape(
    request:
      ShapeCastRequest,
  ): ShapeCastHit {
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
          ...ZERO_VECTOR,
        },
        normal: {
          ...ZERO_VECTOR,
        },
      };
    }

    this.refreshQueriesIfDirty();

    return RaycasterQueries
      .castShape(
        this.world,
        this.handleToEntityMap,
        request,
        this.entityToBodyMap,
      );
  }

  public queryOverlap(
    request:
      OverlapQueryRequest,
  ): string[] {
    if (
      this.world ===
        null ||
      this.disposed
    ) {
      return [];
    }

    this.refreshQueriesIfDirty();

    return RaycasterQueries
      .queryOverlap(
        this.world,
        this.handleToEntityMap,
        request,
        this.entityToBodyMap,
      );
  }

  /**
   * Retorna um snapshot NOVO (seguro para guardar/mutar pelo chamador).
   * Para leitura sem alocação use getBodyTransformInto.
   */
  public getBodyTransform(
    entityId: string,
  ): {
    position:
      Vector3DTO;
    rotation:
      QuaternionDTO;
  } | null {
    const out = {
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

    return this.getBodyTransformInto(
      entityId,
      out,
    )
      ? out
      : null;
  }

  public getBodyTransformInto(
    entityId: string,
    out:
      MutableBodyTransformDTO,
  ): boolean {
    const body =
      this.getBody(
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

    out.position.x =
      translation.x;

    out.position.y =
      translation.y;

    out.position.z =
      translation.z;

    out.rotation.x =
      rotation.x;

    out.rotation.y =
      rotation.y;

    out.rotation.z =
      rotation.z;

    out.rotation.w =
      rotation.w;

    return true;
  }

  public setBodyTranslation(
    entityId: string,
    position:
      Vector3DTO,
    wakeUp = true,
  ): boolean {
    const body =
      this.getBody(
        entityId,
      );

    if (
      body ===
      undefined
    ) {
      return false;
    }

    assertVector3(
      position,
      "position",
    );

    body.setTranslation(
      toRapierVector(
        position,
      ),
      wakeUp,
    );

    this.queriesDirty =
      true;

    return true;
  }

  public setBodyRotation(
    entityId: string,
    rotation:
      QuaternionDTO,
    wakeUp = true,
  ): boolean {
    const body =
      this.getBody(
        entityId,
      );

    if (
      body ===
      undefined
    ) {
      return false;
    }

    assertQuaternion(
      rotation,
    );

    body.setRotation(
      toRapierQuaternion(
        rotation,
      ),
      wakeUp,
    );

    this.queriesDirty =
      true;

    return true;
  }

  public setBodyTransform(
    entityId: string,
    transform:
      Partial<BodyTransformDTO>,
    wakeUp = true,
  ): boolean {
    const body =
      this.getBody(
        entityId,
      );

    if (
      body ===
      undefined
    ) {
      return false;
    }

    // Valida tudo antes de aplicar (sem aplicação parcial).
    if (
      transform.position !==
      undefined
    ) {
      assertVector3(
        transform.position,
        "position",
      );
    }

    if (
      transform.rotation !==
      undefined
    ) {
      assertQuaternion(
        transform.rotation,
      );
    }

    if (
      transform.position !==
      undefined
    ) {
      body.setTranslation(
        toRapierVector(
          transform.position,
        ),
        wakeUp,
      );
    }

    if (
      transform.rotation !==
      undefined
    ) {
      body.setRotation(
        toRapierQuaternion(
          transform.rotation,
        ),
        wakeUp,
      );
    }

    this.queriesDirty =
      true;

    return true;
  }

  public setNextKinematicTransform(
    entityId: string,
    target:
      KinematicTargetDTO,
  ): boolean {
    const body =
      this.getBody(
        entityId,
      );

    if (
      body ===
        undefined ||
      body.bodyType() !==
        RAPIER.RigidBodyType
          .KinematicPositionBased
    ) {
      return false;
    }

    if (
      target.position !==
      undefined
    ) {
      assertVector3(
        target.position,
        "position",
      );
    }

    if (
      target.rotation !==
      undefined
    ) {
      assertQuaternion(
        target.rotation,
      );
    }

    if (
      target.position !==
      undefined
    ) {
      body.setNextKinematicTranslation(
        toRapierVector(
          target.position,
        ),
      );
    }

    if (
      target.rotation !==
      undefined
    ) {
      body.setNextKinematicRotation(
        toRapierQuaternion(
          target.rotation,
        ),
      );
    }

    return true;
  }

  public getLinearVelocity(
    entityId: string,
  ): Vector3DTO | null {
    const body =
      this.getBody(
        entityId,
      );

    if (
      body ===
      undefined
    ) {
      return null;
    }

    const velocity =
      body.linvel();

    return {
      x:
        velocity.x,
      y:
        velocity.y,
      z:
        velocity.z,
    };
  }

  public setLinearVelocity(
    entityId: string,
    velocity:
      Vector3DTO,
    wakeUp = true,
  ): boolean {
    const body =
      this.getVelocityDrivenBody(
        entityId,
      );

    if (
      body ===
      undefined
    ) {
      return false;
    }

    assertVector3(
      velocity,
      "velocity",
    );

    body.setLinvel(
      toRapierVector(
        velocity,
      ),
      wakeUp,
    );

    return true;
  }

  public getAngularVelocity(
    entityId: string,
  ): Vector3DTO | null {
    const body =
      this.getBody(
        entityId,
      );

    if (
      body ===
      undefined
    ) {
      return null;
    }

    const velocity =
      body.angvel();

    return {
      x:
        velocity.x,
      y:
        velocity.y,
      z:
        velocity.z,
    };
  }

  public setAngularVelocity(
    entityId: string,
    velocity:
      Vector3DTO,
    wakeUp = true,
  ): boolean {
    const body =
      this.getVelocityDrivenBody(
        entityId,
      );

    if (
      body ===
      undefined
    ) {
      return false;
    }

    assertVector3(
      velocity,
      "angularVelocity",
    );

    body.setAngvel(
      toRapierVector(
        velocity,
      ),
      wakeUp,
    );

    return true;
  }

  public setEnabledRotations(
    entityId: string,
    axes:
      AxisFlagsDTO,
    wakeUp = true,
  ): boolean {
    const body =
      this.getBody(
        entityId,
      );

    if (
      body ===
      undefined
    ) {
      return false;
    }

    if (
      typeof axes.x !==
        "boolean" ||
      typeof axes.y !==
        "boolean" ||
      typeof axes.z !==
        "boolean"
    ) {
      throw new RangeError(
        "axes precisa ser {x:boolean,y:boolean,z:boolean}.",
      );
    }

    body.setEnabledRotations(
      axes.x,
      axes.y,
      axes.z,
      wakeUp,
    );

    return true;
  }

  public lockRotations(
    entityId: string,
    locked: boolean,
    wakeUp = true,
  ): boolean {
    const body =
      this.getBody(
        entityId,
      );

    if (
      body ===
      undefined
    ) {
      return false;
    }

    body.lockRotations(
      locked,
      wakeUp,
    );

    if (
      locked
    ) {
      // Zera a rotação residual para o corpo parar de girar imediatamente.
      body.setAngvel(
        toRapierVector(
          ZERO_VECTOR,
        ),
        wakeUp,
      );
    }

    return true;
  }

  public getBodyMass(
    entityId: string,
  ): number | null {
    const body =
      this.getBody(
        entityId,
      );

    return body ===
      undefined
      ? null
      : body.mass();
  }

  public isBodySleeping(
    entityId: string,
  ): boolean | null {
    const body =
      this.getBody(
        entityId,
      );

    return body ===
      undefined
      ? null
      : body.isSleeping();
  }

  public wakeBody(
    entityId: string,
  ): boolean {
    const body =
      this.getBody(
        entityId,
      );

    if (
      body ===
      undefined
    ) {
      return false;
    }

    body.wakeUp();

    return true;
  }

  public setCollisionGroups(
    entityId: string,
    groups:
      CollisionGroupsDTO,
  ): boolean {
    const body =
      this.getBody(
        entityId,
      );

    if (
      body ===
      undefined
    ) {
      return false;
    }

    const packed =
      toInteractionGroups(
        groups,
      );

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
      body.collider(
        index,
      ).setCollisionGroups(
        packed,
      );
    }

    this.queriesDirty =
      true;

    return true;
  }

  public createJoint(
    jointId: string,
    desc:
      JointDescriptor,
  ): boolean {
    if (
      this.world ===
        null ||
      this.disposed
    ) {
      return false;
    }

    if (
      typeof jointId !==
        "string" ||
      jointId.trim()
        .length ===
        0
    ) {
      throw new RangeError(
        "jointId não pode ser vazio.",
      );
    }

    const bodyA =
      this.entityToBodyMap.get(
        desc.entityIdA,
      );

    const bodyB =
      this.entityToBodyMap.get(
        desc.entityIdB,
      );

    if (
      bodyA ===
        undefined ||
      bodyB ===
        undefined ||
      bodyA ===
        bodyB
    ) {
      return false;
    }

    const data =
      this.createJointData(
        desc,
      );

    if (
      this.joints.has(
        jointId,
      )
    ) {
      this.removeJoint(
        jointId,
      );
    }

    const joint =
      this.world.createImpulseJoint(
        data,
        bodyA,
        bodyB,
        true,
      );

    if (
      desc.collideConnected ===
      false
    ) {
      joint.setContactsEnabled(
        false,
      );
    }

    this.joints.set(
      jointId,
      {
        joint,
        type:
          desc.type,
        entityIdA:
          desc.entityIdA,
        entityIdB:
          desc.entityIdB,
      },
    );

    return true;
  }

  public removeJoint(
    jointId: string,
  ): boolean {
    const record =
      this.joints.get(
        jointId,
      );

    if (
      record ===
        undefined ||
      this.world ===
        null
    ) {
      return false;
    }

    this.joints.delete(
      jointId,
    );

    if (
      record.joint.isValid()
    ) {
      this.world.removeImpulseJoint(
        record.joint,
        true,
      );
    }

    return true;
  }

  public hasJoint(
    jointId: string,
  ): boolean {
    return this.joints.has(
      jointId,
    );
  }

  public setJointMotor(
    jointId: string,
    motor:
      JointMotorDTO,
  ): boolean {
    const record =
      this.joints.get(
        jointId,
      );

    if (
      record ===
        undefined ||
      (
        record.type !==
          "revolute" &&
        record.type !==
          "prismatic"
      )
    ) {
      return false;
    }

    const targetPosition =
      motor.targetPosition ?? 0;
    const targetVelocity =
      motor.targetVelocity ?? 0;
    const stiffness =
      motor.stiffness ?? 0;
    const damping =
      motor.damping ?? 0;

    if (
      !Number.isFinite(
        targetPosition,
      ) ||
      !Number.isFinite(
        targetVelocity,
      ) ||
      !Number.isFinite(
        stiffness,
      ) ||
      !Number.isFinite(
        damping,
      ) ||
      stiffness <
        0 ||
      damping <
        0
    ) {
      throw new RangeError(
        "motor precisa de valores finitos (stiffness/damping >= 0).",
      );
    }

    (
      record.joint as
        RAPIER.UnitImpulseJoint
    ).configureMotor(
      targetPosition,
      targetVelocity,
      stiffness,
      damping,
    );

    record.joint.body1()
      .wakeUp();
    record.joint.body2()
      .wakeUp();

    return true;
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

    // Corpos dormindo não reagem à nova gravidade até acordar.
    for (
      const body of
      this.entityToBodyMap.values()
    ) {
      if (
        body.bodyType() ===
        RAPIER.RigidBodyType
          .Dynamic
      ) {
        body.wakeUp();
      }
    }
  }

  public getGravity():
    Vector3DTO {
    if (
      this.world ===
      null
    ) {
      return {
        ...ZERO_VECTOR,
      };
    }

    const gravity =
      this.world.gravity;

    return {
      x:
        gravity.x,
      y:
        gravity.y,
      z:
        gravity.z,
    };
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
    this.joints.clear();
    this.removalHandles.clear();
    this.attachedEventManager =
      null;

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

  private assertEntityId(
    entityId: string,
  ): void {
    if (
      typeof entityId !==
        "string" ||
      entityId.trim()
        .length ===
        0
    ) {
      throw new RangeError(
        "entityId não pode ser vazio.",
      );
    }
  }

  private getBody(
    entityId: string,
  ): RAPIER.RigidBody | undefined {
    if (
      this.world ===
        null ||
      this.disposed
    ) {
      return undefined;
    }

    return this.entityToBodyMap.get(
      entityId,
    );
  }

  private getDynamicBody(
    entityId: string,
  ): RAPIER.RigidBody | undefined {
    const body =
      this.getBody(
        entityId,
      );

    return body !==
        undefined &&
      body.bodyType() ===
        RAPIER.RigidBodyType
          .Dynamic
      ? body
      : undefined;
  }

  /** dynamic ou kinematicVelocityBased: aceitam velocidade definida pelo usuário. */
  private getVelocityDrivenBody(
    entityId: string,
  ): RAPIER.RigidBody | undefined {
    const body =
      this.getBody(
        entityId,
      );

    if (
      body ===
      undefined
    ) {
      return undefined;
    }

    const type =
      body.bodyType();

    return type ===
        RAPIER.RigidBodyType
          .Dynamic ||
      type ===
        RAPIER.RigidBodyType
          .KinematicVelocityBased
      ? body
      : undefined;
  }

  private attachCollider(
    entityId: string,
    body:
      RAPIER.RigidBody,
    colliderDesc:
      RAPIER.ColliderDesc,
    isSensor: boolean,
  ): void {
    if (
      this.world ===
      null
    ) {
      return;
    }

    const collider =
      this.world.createCollider(
        colliderDesc,
        body,
      );

    this.handleToEntityMap.set(
      collider.handle,
      entityId,
    );

    this.handleToSensorMap.set(
      collider.handle,
      isSensor,
    );

    // Sem isto a massa só é atualizada no próximo step (getBodyMass imediato).
    body.recomputeMassPropertiesFromColliders();
  }

  private createJointData(
    desc:
      JointDescriptor,
  ): RAPIER.JointData {
    const anchorA =
      desc.anchorA ?? ZERO_VECTOR;
    const anchorB =
      desc.anchorB ?? ZERO_VECTOR;

    assertVector3(
      anchorA,
      "anchorA",
    );
    assertVector3(
      anchorB,
      "anchorB",
    );

    const rapierAnchorA =
      toRapierVector(
        anchorA,
      );
    const rapierAnchorB =
      toRapierVector(
        anchorB,
      );

    const readAxis = (): RAPIER.Vector3 => {
      const axis =
        desc.axis;

      if (
        axis ===
        undefined
      ) {
        throw new RangeError(
          `joint ${desc.type} requer axis.`,
        );
      }

      assertVector3(
        axis,
        "axis",
      );

      const length =
        Math.hypot(
          axis.x,
          axis.y,
          axis.z,
        );

      if (
        length <=
        Number.EPSILON
      ) {
        throw new RangeError(
          "axis não pode ser o vetor zero.",
        );
      }

      return new RAPIER.Vector3(
        axis.x /
          length,
        axis.y /
          length,
        axis.z /
          length,
      );
    };

    let data: RAPIER.JointData;

    switch (
      desc.type
    ) {
      case "fixed": {
        const frameA =
          desc.frameA ?? IDENTITY_ROTATION;
        const frameB =
          desc.frameB ?? IDENTITY_ROTATION;

        assertQuaternion(
          frameA,
          "frameA",
        );
        assertQuaternion(
          frameB,
          "frameB",
        );

        data =
          RAPIER.JointData.fixed(
            rapierAnchorA,
            toRapierQuaternion(
              frameA,
            ),
            rapierAnchorB,
            toRapierQuaternion(
              frameB,
            ),
          );
        break;
      }

      case "spherical":
        data =
          RAPIER.JointData.spherical(
            rapierAnchorA,
            rapierAnchorB,
          );
        break;

      case "revolute":
        data =
          RAPIER.JointData.revolute(
            rapierAnchorA,
            rapierAnchorB,
            readAxis(),
          );
        break;

      case "prismatic":
        data =
          RAPIER.JointData.prismatic(
            rapierAnchorA,
            rapierAnchorB,
            readAxis(),
          );
        break;

      case "rope": {
        const length =
          desc.length ?? 1;

        if (
          !Number.isFinite(
            length,
          ) ||
          length <
            0
        ) {
          throw new RangeError(
            "rope.length precisa ser finito e >= 0.",
          );
        }

        data =
          RAPIER.JointData.rope(
            length,
            rapierAnchorA,
            rapierAnchorB,
          );
        break;
      }

      case "spring": {
        const length =
          desc.length ?? 1;
        const stiffness =
          desc.stiffness ?? 1;
        const damping =
          desc.damping ?? 0;

        if (
          !Number.isFinite(
            length,
          ) ||
          !Number.isFinite(
            stiffness,
          ) ||
          !Number.isFinite(
            damping,
          ) ||
          length <
            0 ||
          stiffness <
            0 ||
          damping <
            0
        ) {
          throw new RangeError(
            "spring precisa de length/stiffness/damping finitos e >= 0.",
          );
        }

        data =
          RAPIER.JointData.spring(
            length,
            stiffness,
            damping,
            rapierAnchorA,
            rapierAnchorB,
          );
        break;
      }

      default:
        throw new RangeError(
          `JointType inválido: ${String((desc as { type: unknown }).type)}.`,
        );
    }

    if (
      desc.limits !==
      undefined
    ) {
      if (
        desc.type !==
          "revolute" &&
        desc.type !==
          "prismatic"
      ) {
        throw new RangeError(
          "limits só se aplica a joints revolute/prismatic.",
        );
      }

      if (
        !Number.isFinite(
          desc.limits.min,
        ) ||
        !Number.isFinite(
          desc.limits.max,
        ) ||
        desc.limits.min >
          desc.limits.max
      ) {
        throw new RangeError(
          "limits precisa ter min <= max finitos.",
        );
      }

      data.limitsEnabled =
        true;
      data.limits = [
        desc.limits.min,
        desc.limits.max,
      ];
    }

    return data;
  }

  private refreshQueriesIfDirty(): void {
    if (
      !this.queriesDirty ||
      this.world ===
        null
    ) {
      return;
    }

    this.world
      .propagateModifiedBodyPositionsToColliders();
    this.world
      .updateSceneQueries();

    this.queriesDirty =
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
