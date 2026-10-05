import type {
  PluginContext,
} from "@core";

import type {
  ColliderDescriptor,
  PhysicsStats,
  QuaternionDTO,
  RaycastHit,
  RaycastRequest,
  RigidBodyDescriptor,
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
    return this.world
      .getStats();
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
