import type {
  PluginContext,
} from "@core";

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

import type {
  PhysicsApi,
} from "../../../tokens/physics";

import { CollisionEventManager } from "./CollisionEventManager";
import { PhysicsWorld } from "./PhysicsWorld";

export class PhysicsService
  implements PhysicsApi {
  private readonly world:
    PhysicsWorld;

  private readonly eventManager:
    CollisionEventManager;

  private disposed =
    false;

  public constructor(
    ctx:
      PluginContext,
    world:
      PhysicsWorld =
        new PhysicsWorld(),
  ) {
    this.world =
      world;

    this.eventManager =
      new CollisionEventManager(
        ctx,
      );

    this.world.attachEventManager(
      this.eventManager,
    );
  }

  public async initialize():
    Promise<boolean> {
    if (
      this.disposed
    ) {
      return false;
    }

    return this.world
      .initialize();
  }

  public step(
    deltaTimeSeconds:
      number,
  ): void {
    if (
      this.disposed
    ) {
      return;
    }

    this.world.step(
      deltaTimeSeconds,
      this.eventManager,
    );

    // A API pública v1 permanece síncrona. Eventos são enviados pela
    // EmitQueue do Kernel. O caminho do game.loop abaixo é serial/awaited.
    this.eventManager
      .flushQueued();
  }

  public async stepForGameLoop(
    deltaTimeSeconds:
      number,
  ): Promise<void> {
    if (
      this.disposed
    ) {
      return;
    }

    this.world.step(
      deltaTimeSeconds,
      this.eventManager,
    );

    // Stage 75 garante que game.loop.tick espera seus handlers.
    // A física, por sua vez, espera os eventos de colisão/trigger daquele
    // step antes de permitir que o próximo fixed tick prossiga.
    await this.eventManager
      .flushSerial();
  }

  public createBody(
    entityId: string,
    bodyDesc:
      RigidBodyDescriptor,
    colliderDesc?:
      ColliderDescriptor,
  ): boolean {
    return (
      !this.disposed &&
      this.world.createBody(
        entityId,
        bodyDesc,
        colliderDesc,
      )
    );
  }

  public removeBody(
    entityId: string,
  ): boolean {
    return (
      !this.disposed &&
      this.world.removeBody(
        entityId,
      )
    );
  }

  public applyImpulse(
    entityId: string,
    impulse:
      Vector3DTO,
  ): boolean {
    return (
      !this.disposed &&
      this.world.applyImpulse(
        entityId,
        impulse,
      )
    );
  }

  public applyForce(
    entityId: string,
    force:
      Vector3DTO,
  ): boolean {
    return (
      !this.disposed &&
      this.world.applyForce(
        entityId,
        force,
      )
    );
  }

  public castRay(
    request:
      RaycastRequest,
  ): RaycastHit {
    return this.world.castRay(
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
    if (
      this.disposed
    ) {
      return null;
    }

    return this.world
      .getBodyTransform(
        entityId,
      );
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
    return (
      !this.disposed &&
      this.world
        .syncMeshTransform(
          entityId,
          targetMesh,
        )
    );
  }

  public setGravity(
    gravity:
      Vector3DTO,
  ): void {
    if (
      this.disposed
    ) {
      return;
    }

    this.world.setGravity(
      gravity,
    );
  }

  public getStats():
    PhysicsStats {
    const stats =
      this.world.getStats();

    // Cópia: o objeto interno é reutilizado (G31).
    return {
      rigidBodyCount:
        stats.rigidBodyCount,
      colliderCount:
        stats.colliderCount,
      stepTimeMs:
        stats.stepTimeMs,
      isWasmLoaded:
        stats.isWasmLoaded,
    };
  }

  public addCollider(
    entityId: string,
    colliderDesc:
      ColliderDescriptor,
  ): boolean {
    return (
      !this.disposed &&
      this.world.addCollider(
        entityId,
        colliderDesc,
      )
    );
  }

  public hasBody(
    entityId: string,
  ): boolean {
    return (
      !this.disposed &&
      this.world.hasBody(
        entityId,
      )
    );
  }

  public applyTorqueImpulse(
    entityId: string,
    torqueImpulse:
      Vector3DTO,
  ): boolean {
    return (
      !this.disposed &&
      this.world.applyTorqueImpulse(
        entityId,
        torqueImpulse,
      )
    );
  }

  public resetForces(
    entityId: string,
  ): boolean {
    return (
      !this.disposed &&
      this.world.resetForces(
        entityId,
      )
    );
  }

  public castShape(
    request:
      ShapeCastRequest,
  ): ShapeCastHit {
    return this.world.castShape(
      request,
    );
  }

  public queryOverlap(
    request:
      OverlapQueryRequest,
  ): string[] {
    return this.world.queryOverlap(
      request,
    );
  }

  public getBodyTransformInto(
    entityId: string,
    out:
      MutableBodyTransformDTO,
  ): boolean {
    return (
      !this.disposed &&
      this.world.getBodyTransformInto(
        entityId,
        out,
      )
    );
  }

  public setBodyTranslation(
    entityId: string,
    position:
      Vector3DTO,
    wakeUp = true,
  ): boolean {
    return (
      !this.disposed &&
      this.world.setBodyTranslation(
        entityId,
        position,
        wakeUp,
      )
    );
  }

  public setBodyRotation(
    entityId: string,
    rotation:
      QuaternionDTO,
    wakeUp = true,
  ): boolean {
    return (
      !this.disposed &&
      this.world.setBodyRotation(
        entityId,
        rotation,
        wakeUp,
      )
    );
  }

  public setBodyTransform(
    entityId: string,
    transform:
      Partial<BodyTransformDTO>,
    wakeUp = true,
  ): boolean {
    return (
      !this.disposed &&
      this.world.setBodyTransform(
        entityId,
        transform,
        wakeUp,
      )
    );
  }

  public setNextKinematicTransform(
    entityId: string,
    target:
      KinematicTargetDTO,
  ): boolean {
    return (
      !this.disposed &&
      this.world.setNextKinematicTransform(
        entityId,
        target,
      )
    );
  }

  public getLinearVelocity(
    entityId: string,
  ): Vector3DTO | null {
    return this.disposed
      ? null
      : this.world.getLinearVelocity(
          entityId,
        );
  }

  public setLinearVelocity(
    entityId: string,
    velocity:
      Vector3DTO,
    wakeUp = true,
  ): boolean {
    return (
      !this.disposed &&
      this.world.setLinearVelocity(
        entityId,
        velocity,
        wakeUp,
      )
    );
  }

  public getAngularVelocity(
    entityId: string,
  ): Vector3DTO | null {
    return this.disposed
      ? null
      : this.world.getAngularVelocity(
          entityId,
        );
  }

  public setAngularVelocity(
    entityId: string,
    velocity:
      Vector3DTO,
    wakeUp = true,
  ): boolean {
    return (
      !this.disposed &&
      this.world.setAngularVelocity(
        entityId,
        velocity,
        wakeUp,
      )
    );
  }

  public setEnabledRotations(
    entityId: string,
    axes:
      AxisFlagsDTO,
    wakeUp = true,
  ): boolean {
    return (
      !this.disposed &&
      this.world.setEnabledRotations(
        entityId,
        axes,
        wakeUp,
      )
    );
  }

  public lockRotations(
    entityId: string,
    locked: boolean,
    wakeUp = true,
  ): boolean {
    return (
      !this.disposed &&
      this.world.lockRotations(
        entityId,
        locked,
        wakeUp,
      )
    );
  }

  public getBodyMass(
    entityId: string,
  ): number | null {
    return this.disposed
      ? null
      : this.world.getBodyMass(
          entityId,
        );
  }

  public isBodySleeping(
    entityId: string,
  ): boolean | null {
    return this.disposed
      ? null
      : this.world.isBodySleeping(
          entityId,
        );
  }

  public wakeBody(
    entityId: string,
  ): boolean {
    return (
      !this.disposed &&
      this.world.wakeBody(
        entityId,
      )
    );
  }

  public setCollisionGroups(
    entityId: string,
    groups:
      CollisionGroupsDTO,
  ): boolean {
    return (
      !this.disposed &&
      this.world.setCollisionGroups(
        entityId,
        groups,
      )
    );
  }

  public createJoint(
    jointId: string,
    desc:
      JointDescriptor,
  ): boolean {
    return (
      !this.disposed &&
      this.world.createJoint(
        jointId,
        desc,
      )
    );
  }

  public removeJoint(
    jointId: string,
  ): boolean {
    return (
      !this.disposed &&
      this.world.removeJoint(
        jointId,
      )
    );
  }

  public hasJoint(
    jointId: string,
  ): boolean {
    return (
      !this.disposed &&
      this.world.hasJoint(
        jointId,
      )
    );
  }

  public setJointMotor(
    jointId: string,
    motor:
      JointMotorDTO,
  ): boolean {
    return (
      !this.disposed &&
      this.world.setJointMotor(
        jointId,
        motor,
      )
    );
  }

  public getGravity():
    Vector3DTO {
    return this.world.getGravity();
  }

  public dispose(): void {
    if (
      this.disposed
    ) {
      return;
    }

    this.disposed =
      true;

    this.eventManager.clear();
    this.world.dispose();
  }
}
