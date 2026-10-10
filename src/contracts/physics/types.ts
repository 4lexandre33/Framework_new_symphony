import { defineEvent, defineCommand } from "@core";

export type RigidBodyType = "dynamic" | "fixed" | "kinematicPositionBased" | "kinematicVelocityBased";

export type ColliderShapeType =
  | "box"
  | "sphere"
  | "capsule"
  | "trimesh"
  | "cylinder"
  | "cone"
  | "convexHull"
  | "heightfield";

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
  /** Trava TODAS as rotações (personagens em pé). Equivale a enabledRotations {false,false,false}. */
  readonly lockRotations?: boolean;
  /** Habilita rotação por eixo (ex.: { x: false, y: true, z: false } = só gira em Y). */
  readonly enabledRotations?: AxisFlagsDTO;
  /** Trava todas as translações (o corpo só gira). */
  readonly lockTranslations?: boolean;
  /** Velocidade linear inicial (dynamic / kinematicVelocityBased). */
  readonly linearVelocity?: Vector3DTO;
  /** Velocidade angular inicial em rad/s (dynamic / kinematicVelocityBased). */
  readonly angularVelocity?: Vector3DTO;
  /** Continuous collision detection para corpos rápidos (projéteis). */
  readonly ccd?: boolean;
  /** Massa adicional somada à massa derivada da densidade dos colliders. */
  readonly additionalMass?: number;
}

export interface AxisFlagsDTO {
  readonly x: boolean;
  readonly y: boolean;
  readonly z: boolean;
}

/**
 * Grupos de colisão (16 bits cada). Dois colliders A e B interagem quando
 * (A.memberships & B.filter) !== 0 && (B.memberships & A.filter) !== 0.
 * Padrão: memberships 0xffff, filter 0xffff (colide com tudo).
 */
export interface CollisionGroupsDTO {
  readonly memberships: number;
  readonly filter: number;
}

export interface ColliderDescriptor {
  readonly shapeType: ColliderShapeType;
  readonly halfExtents?: Vector3DTO; // Para Box (x, y, z)
  readonly radius?: number; // Para Sphere e Capsule
  readonly halfHeight?: number; // Para Capsule
  readonly vertices?: Float32Array; // Para Trimesh e ConvexHull (pontos x,y,z)
  readonly indices?: Uint32Array; // Para Trimesh
  /** Heightfield: alturas em ordem column-major ((rows+1) * (cols+1) valores). */
  readonly heights?: Float32Array;
  /** Heightfield: número de subdivisões em Z (linhas). As alturas têm rows+1 linhas. */
  readonly rows?: number;
  /** Heightfield: número de subdivisões em X (colunas). As alturas têm cols+1 colunas. */
  readonly cols?: number;
  /** Heightfield: tamanho total (x, z) e multiplicador de altura (y). */
  readonly scale?: Vector3DTO;
  readonly friction?: number;
  /** >= 0. Valores > 1 adicionam energia (molas/trampolins). */
  readonly restitution?: number;
  readonly isSensor?: boolean;
  readonly density?: number;
  /** Translação local do collider relativa ao corpo (compound shapes, pés do personagem). */
  readonly offset?: Vector3DTO;
  /** Rotação local do collider relativa ao corpo. */
  readonly rotationOffset?: QuaternionDTO;
  /** Grupos de colisão/filtro deste collider. */
  readonly collisionGroups?: CollisionGroupsDTO;
  /**
   * Quando definido (>= 0), emite `game.physics.contact-force` sempre que a
   * força total de contato deste collider ultrapassar o limiar (impactos).
   */
  readonly contactForceThreshold?: number;
}

/** Filtro comum a raycast, shape-cast e overlap. */
export interface PhysicsQueryFilter {
  /** Ignora todos os colliders desta entidade (ex.: o próprio personagem). */
  readonly excludeEntityId?: string;
  /** Ignora sensores/triggers. */
  readonly excludeSensors?: boolean;
  /** Considera só colliders compatíveis com estes grupos. */
  readonly collisionGroups?: CollisionGroupsDTO;
}

export interface RaycastRequest extends PhysicsQueryFilter {
  readonly origin: Vector3DTO;
  readonly direction: Vector3DTO;
  readonly maxDistance: number;
  readonly solid?: boolean;
}

/** Forma usada em consultas (shape-cast / overlap). Mesmos campos de dimensão do ColliderDescriptor. */
export interface QueryShapeDescriptor {
  readonly shapeType: "box" | "sphere" | "capsule" | "cylinder" | "cone";
  readonly halfExtents?: Vector3DTO;
  readonly radius?: number;
  readonly halfHeight?: number;
}

export interface ShapeCastRequest extends PhysicsQueryFilter {
  readonly shape: QueryShapeDescriptor;
  readonly position: Vector3DTO;
  readonly rotation?: QuaternionDTO;
  /** Direção do movimento (não precisa ser normalizada). */
  readonly direction: Vector3DTO;
  readonly maxDistance: number;
}

export interface ShapeCastHit {
  readonly hit: boolean;
  /** Distância percorrida pela forma até o primeiro contato. */
  readonly distance: number;
  /** Ponto de contato no collider atingido (mundo). */
  readonly point: Vector3DTO;
  /** Normal da superfície atingida (mundo). */
  readonly normal: Vector3DTO;
  readonly entityId?: string;
}

export interface OverlapQueryRequest extends PhysicsQueryFilter {
  readonly shape: QueryShapeDescriptor;
  readonly position: Vector3DTO;
  readonly rotation?: QuaternionDTO;
}

export interface BodyTransformDTO {
  readonly position: Vector3DTO;
  readonly rotation: QuaternionDTO;
}

/** Destino mutável para leituras sem alocação (`getBodyTransformInto`). */
export interface MutableBodyTransformDTO {
  readonly position: { x: number; y: number; z: number };
  readonly rotation: { x: number; y: number; z: number; w: number };
}

export interface KinematicTargetDTO {
  readonly position?: Vector3DTO;
  readonly rotation?: QuaternionDTO;
}

// ── JOINTS ─────────────────────────────────────────────────────────────────

export type JointType = "fixed" | "revolute" | "spherical" | "prismatic" | "rope" | "spring";

export interface JointLimitsDTO {
  readonly min: number;
  readonly max: number;
}

export interface JointDescriptor {
  readonly type: JointType;
  readonly entityIdA: string;
  readonly entityIdB: string;
  /** Ponto de ancoragem no espaço local do corpo A. Padrão (0,0,0). */
  readonly anchorA?: Vector3DTO;
  /** Ponto de ancoragem no espaço local do corpo B. Padrão (0,0,0). */
  readonly anchorB?: Vector3DTO;
  /** Eixo (local) de revolute/prismatic. Obrigatório para esses tipos. */
  readonly axis?: Vector3DTO;
  /** Orientação relativa (fixed). Padrão identidade. */
  readonly frameA?: QuaternionDTO;
  readonly frameB?: QuaternionDTO;
  /** Limites (rad para revolute, unidades para prismatic). */
  readonly limits?: JointLimitsDTO;
  /** rope: comprimento máximo; spring: comprimento de repouso. */
  readonly length?: number;
  /** spring */
  readonly stiffness?: number;
  /** spring */
  readonly damping?: number;
  /** Se os corpos ligados colidem entre si. Padrão true (comportamento Rapier). */
  readonly collideConnected?: boolean;
}

export interface JointMotorDTO {
  readonly targetPosition?: number;
  readonly targetVelocity?: number;
  readonly stiffness?: number;
  readonly damping?: number;
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
  /** true quando o exit foi gerado porque um dos corpos foi removido/recriado. */
  readonly removed?: boolean;
}

export interface ContactForceEventPayload {
  readonly entityIdA: string;
  readonly entityIdB: string;
  /** Módulo da soma das forças de contato do par neste step (N). */
  readonly totalForceMagnitude: number;
  /** Maior força individual de contato do par neste step (N). */
  readonly maxForceMagnitude: number;
  readonly totalForce: Vector3DTO;
}

/**
 * Emitido quando a força de contato de um par excede o `contactForceThreshold`
 * de um dos colliders (intensidade de impacto).
 */
export const ContactForceEvent = defineEvent<"game.physics.contact-force", ContactForceEventPayload>(
  "game.physics.contact-force"
);

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