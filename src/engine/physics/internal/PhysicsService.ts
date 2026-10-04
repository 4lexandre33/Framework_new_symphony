import type { PluginContext } from "@core";
import { type PhysicsApi } from "../../../tokens/physics";
import { type ColliderDescriptor, type PhysicsStats, type QuaternionDTO, type RaycastHit, type RaycastRequest, type RigidBodyDescriptor, type Vector3DTO } from "../../../contracts/physics/types";
import { PhysicsWorld } from "./PhysicsWorld";
import { CollisionEventManager } from "./CollisionEventManager";

export class PhysicsService
  implements PhysicsApi {
  private readonly world =
    new PhysicsWorld();

  private readonly eventManager:
    CollisionEventManager;

  public constructor(
    ctx:
      PluginContext,
  ) {
    this.eventManager =
      new CollisionEventManager(
        ctx,
      );
  }

  public async initialize():
    Promise<boolean> {
    return await this.world
      .initialize();
  }

  public step(
    deltaTimeSeconds: number,
  ): void {
    this.world.step(
      deltaTimeSeconds,
      this.eventManager,
    );
  }

  public createBody(
    entityId: string,
    bodyDesc:
      RigidBodyDescriptor,
    colliderDesc?:
      ColliderDescriptor,
  ): boolean {
    return this.world.createBody(
      entityId,
      bodyDesc,
      colliderDesc,
    );
  }

  public removeBody(
    entityId: string,
  ): boolean {
    return this.world.removeBody(
      entityId,
    );
  }

  public applyImpulse(
    entityId: string,
    impulse:
      Vector3DTO,
  ): boolean {
    return this.world
      .applyImpulse(
        entityId,
        impulse,
      );
  }

  public applyForce(
    entityId: string,
    force:
      Vector3DTO,
  ): boolean {
    return this.world
      .applyForce(
        entityId,
        force,
      );
  }

  public castRay(
    request:
      RaycastRequest,
  ): RaycastHit {
    return this.world
      .castRay(
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
    return this.world
      .syncMeshTransform(
        entityId,
        targetMesh,
      );
  }

  public setGravity(
    gravity:
      Vector3DTO,
  ): void {
    this.world.setGravity(
      gravity,
    );
  }

  public getStats():
    PhysicsStats {
    return this.world
      .getStats();
  }

  public dispose(): void {
    this.world.dispose();
  }
}
