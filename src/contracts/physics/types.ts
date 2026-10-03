import { defineEvent, defineCommand } from "../../core/contracts";

export type RigidBodyType = "dynamic" | "fixed" | "kinematicPositionBased" | "kinematicVelocityBased";

export type ColliderShapeType = "box" | "sphere" | "capsule" | "trimesh";

export interface Vector3DTO {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface QuaternionDTO {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export interface RigidBodyDescriptor {
  readonly bodyType: RigidBodyType;
  readonly position?: Vector3DTO;
  readonly rotation?: QuaternionDTO;
  readonly linearDamping?: number;
  readonly angularDamping?: number;
  readonly gravityScale?: number;
  readonly canSleep?: boolean;
}

export interface ColliderDescriptor {
  readonly shapeType: ColliderShapeType;
  readonly halfExtents?: Vector3DTO; // Para Box (x, y, z)
  readonly radius?: number; // Para Sphere e Capsule
  readonly halfHeight?: number; // Para Capsule
  readonly vertices?: Float32Array; // Para Trimesh
  readonly indices?: Uint32Array; // Para Trimesh
  readonly friction?: number;
  readonly restitution?: number;
  readonly isSensor?: boolean;
  readonly density?: number;
}

export interface RaycastRequest {
  readonly origin: Vector3DTO;
  readonly direction: Vector3DTO;
  readonly maxDistance: number;
  readonly solid?: boolean;
}

export interface RaycastHit {
  readonly hit: boolean;
  readonly distance: number;
  readonly point: Vector3DTO;
  readonly normal: Vector3DTO;
  readonly entityId?: string;
}

export interface PhysicsStats {
  readonly rigidBodyCount: number;
  readonly colliderCount: number;
  readonly stepTimeMs: number;
  readonly isWasmLoaded: boolean;
}

// ── EVENTOS DE FÍSICA ──────────────────────────────────────────────────────

export interface CollisionEventPayload {
  readonly entityIdA: string;
  readonly entityIdB: string;
  readonly isStarted: boolean;
  readonly isTrigger: boolean;
}

export const CollisionEnterEvent = defineEvent<"game.physics.collision-enter", CollisionEventPayload>(
  "game.physics.collision-enter"
);

export const CollisionExitEvent = defineEvent<"game.physics.collision-exit", CollisionEventPayload>(
  "game.physics.collision-exit"
);

export const TriggerEnterEvent = defineEvent<"game.physics.trigger-enter", CollisionEventPayload>(
  "game.physics.trigger-enter"
);

export const TriggerExitEvent = defineEvent<"game.physics.trigger-exit", CollisionEventPayload>(
  "game.physics.trigger-exit"
);

// ── COMANDOS DE FÍSICA ─────────────────────────────────────────────────────

export interface CreateBodyRequest {
  readonly entityId: string;
  readonly bodyDesc: RigidBodyDescriptor;
  readonly colliderDesc?: ColliderDescriptor;
}

export const CreateBodyCommand = defineCommand<"game.physics.create-body", CreateBodyRequest>(
  "game.physics.create-body"
);

export interface RemoveBodyRequest {
  readonly entityId: string;
}

export const RemoveBodyCommand = defineCommand<"game.physics.remove-body", RemoveBodyRequest>(
  "game.physics.remove-body"
);

export interface ApplyImpulseRequest {
  readonly entityId: string;
  readonly impulse: Vector3DTO;
}

export const ApplyImpulseCommand = defineCommand<"game.physics.apply-impulse", ApplyImpulseRequest>(
  "game.physics.apply-impulse"
);

export interface CastRayRequest {
  readonly ray: RaycastRequest;
}

export const CastRayCommand = defineCommand<"game.physics.cast-ray", CastRayRequest>(
  "game.physics.cast-ray"
);