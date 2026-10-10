import type {
  PerceptionSenseConfig,
  PerceptionSenseType,
  Vector3AI,
} from "../../../contracts/ai/types";

import type {
  PhysicsApi,
} from "../../../tokens/physics";

interface MutableVector3AI {
  x: number;
  y: number;
  z: number;
}

interface MutablePerceptionResult {
  targetSpotted: boolean;
  senseType: PerceptionSenseType;
  targetPosition?: Vector3AI;
}

export interface PerceptionResult {
  readonly targetSpotted: boolean;
  readonly senseType: PerceptionSenseType;
  readonly targetPosition?: Vector3AI;
}

interface MutableRayRequest {
  readonly origin: MutableVector3AI;
  readonly direction: MutableVector3AI;
  maxDistance: number;
  readonly solid: boolean;
  /** G69: o raio ignora o próprio agente (nasce dentro do collider dele). */
  excludeEntityId: string | undefined;
  readonly excludeSensors: boolean;
}

/** Folga para considerar que o raio chegou ao alvo. */
const LOS_EPSILON = 0.05;

export class PerceptionSystem {
  private readonly targetScratch: MutableVector3AI = { x: 0, y: 0, z: 0 };
  private readonly rayOrigin: MutableVector3AI = { x: 0, y: 0, z: 0 };
  private readonly rayDirection: MutableVector3AI = { x: 0, y: 0, z: 1 };

  private readonly rayRequest: MutableRayRequest = {
    origin: this.rayOrigin,
    direction: this.rayDirection,
    maxDistance: 0,
    solid: true,
    excludeEntityId: undefined,
    excludeSensors: true,
  };

  private readonly result: MutablePerceptionResult = {
    targetSpotted: false,
    senseType: "none",
  };

  /**
   * Visão (cone + linha de visão física) e proximidade (hearingRadius) do
   * ALVO-ENTIDADE. Linha de visão (G69): raio dos olhos do agente até o
   * ponto mirado do alvo, ignorando o collider do agente e sensores; acertar
   * o collider do próprio alvo conta como visível.
   */
  public checkPerception(
    agentPos: Vector3AI,
    agentForwardDir: Vector3AI,
    targetPos: Vector3AI,
    config: PerceptionSenseConfig,
    physics?: PhysicsApi | null,
    agentEntityId?: string,
    targetEntityId?: string,
  ): PerceptionResult {
    const dx = targetPos.x - agentPos.x;
    const dy = targetPos.y - agentPos.y;
    const dz = targetPos.z - agentPos.z;
    const distanceSquared = dx * dx + dy * dy + dz * dz;
    const visionDistance = this.sanitizeNonNegative(config.visionDistance ?? 20);

    if (
      distanceSquared <= visionDistance * visionDistance &&
      this.isInsideVisionCone(agentForwardDir, dx, dy, dz, distanceSquared, config) &&
      this.hasLineOfSight(agentPos, targetPos, config, physics ?? null, agentEntityId, targetEntityId)
    ) {
      return this.writeResult(true, "vision", targetPos);
    }

    const hearingRadius = this.sanitizeNonNegative(config.hearingRadius ?? 10);

    if (distanceSquared <= hearingRadius * hearingRadius) {
      return this.writeResult(true, "hearing", targetPos);
    }

    return this.writeResult(false, "none");
  }

  private isInsideVisionCone(
    forward: Vector3AI,
    dx: number,
    dy: number,
    dz: number,
    distanceSquared: number,
    config: PerceptionSenseConfig,
  ): boolean {
    const distance = Math.sqrt(distanceSquared);

    if (distance <= 0.000001) {
      return true;
    }

    const forwardLength = Math.sqrt(forward.x * forward.x + forward.y * forward.y + forward.z * forward.z);

    if (forwardLength <= 0.000001) {
      return false;
    }

    const dot =
      (forward.x * dx + forward.y * dy + forward.z * dz) / (forwardLength * distance);
    const halfFovDegrees = Math.min(180, Math.max(0, config.visionAngleDegrees ?? 90)) * 0.5;

    // Evita Math.acos(): dentro do cone se dot >= cos(meio FOV).
    return dot >= Math.cos(halfFovDegrees * (Math.PI / 180));
  }

  private hasLineOfSight(
    agentPos: Vector3AI,
    targetPos: Vector3AI,
    config: PerceptionSenseConfig,
    physics: PhysicsApi | null,
    agentEntityId: string | undefined,
    targetEntityId: string | undefined,
  ): boolean {
    if (config.checkLineOfSight === false || physics === null) {
      return true;
    }

    const eyeHeight = Number.isFinite(config.eyeHeight) ? (config.eyeHeight as number) : 0;
    const targetHeight = Number.isFinite(config.targetHeight) ? (config.targetHeight as number) : 0;
    const ox = agentPos.x;
    const oy = agentPos.y + eyeHeight;
    const oz = agentPos.z;
    const rx = targetPos.x - ox;
    const ry = targetPos.y + targetHeight - oy;
    const rz = targetPos.z - oz;
    const distance = Math.sqrt(rx * rx + ry * ry + rz * rz);

    if (distance <= 0.000001) {
      return true;
    }

    const inverse = 1 / distance;
    this.rayOrigin.x = ox;
    this.rayOrigin.y = oy;
    this.rayOrigin.z = oz;
    this.rayDirection.x = rx * inverse;
    this.rayDirection.y = ry * inverse;
    this.rayDirection.z = rz * inverse;
    this.rayRequest.maxDistance = distance;
    this.rayRequest.excludeEntityId = agentEntityId;
    const hit = physics.castRay(this.rayRequest);

    if (!hit.hit || hit.distance >= distance - LOS_EPSILON) {
      return true;
    }

    // Acertou o collider do próprio alvo antes do centro: visível.
    return targetEntityId !== undefined && hit.entityId === targetEntityId;
  }

  private writeResult(targetSpotted: boolean, senseType: PerceptionSenseType, target?: Vector3AI): PerceptionResult {
    this.result.targetSpotted = targetSpotted;
    this.result.senseType = senseType;

    if (target) {
      this.targetScratch.x = target.x;
      this.targetScratch.y = target.y;
      this.targetScratch.z = target.z;
      this.result.targetPosition = this.targetScratch;
    } else {
      delete this.result.targetPosition;
    }

    return this.result;
  }

  private sanitizeNonNegative(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }

    return Math.max(0, value);
  }
}
