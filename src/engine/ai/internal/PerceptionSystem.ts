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
  targetSpotted:
    boolean;

  senseType:
    PerceptionSenseType;

  targetPosition?:
    Vector3AI;
}

export interface PerceptionResult {
  readonly targetSpotted:
    boolean;

  readonly senseType:
    PerceptionSenseType;

  readonly targetPosition?:
    Vector3AI;
}

export class PerceptionSystem {
  private readonly targetScratch:
    MutableVector3AI = {
      x: 0,
      y: 0,
      z: 0,
    };

  private readonly rayOrigin:
    MutableVector3AI = {
      x: 0,
      y: 0,
      z: 0,
    };

  private readonly rayDirection:
    MutableVector3AI = {
      x: 0,
      y: 0,
      z: 1,
    };

  private readonly rayRequest = {
    origin:
      this.rayOrigin,

    direction:
      this.rayDirection,

    maxDistance:
      0,

    solid:
      true,
  };

  private readonly result:
    MutablePerceptionResult = {
      targetSpotted:
        false,

      senseType:
        "none",
    };

  public checkPerception(
    agentPos:
      Vector3AI,
    agentForwardDir:
      Vector3AI,
    targetPos:
      Vector3AI,
    config:
      PerceptionSenseConfig,
    physics?:
      PhysicsApi | null,
  ): PerceptionResult {
    const dx =
      targetPos.x -
      agentPos.x;

    const dy =
      targetPos.y -
      agentPos.y;

    const dz =
      targetPos.z -
      agentPos.z;

    const distanceSquared =
      dx * dx +
      dy * dy +
      dz * dz;

    const visionDistance =
      this.sanitizeNonNegative(
        config.visionDistance ??
          20,
      );

    if (
      distanceSquared <=
      visionDistance *
        visionDistance
    ) {
      const distance =
        Math.sqrt(
          distanceSquared,
        );

      /*
       * Mesma posição:
       * é considerado imediatamente visível.
       */
      if (
        distance <=
        0.000001
      ) {
        return this.writeResult(
          true,
          "vision",
          targetPos,
        );
      }

      const forwardLength =
        Math.sqrt(
          agentForwardDir.x *
            agentForwardDir.x +
          agentForwardDir.y *
            agentForwardDir.y +
          agentForwardDir.z *
            agentForwardDir.z,
        );

      if (
        forwardLength >
        0.000001
      ) {
        const inverseForwardLength =
          1 /
          forwardLength;

        const inverseDistance =
          1 /
          distance;

        const dot =
          (
            agentForwardDir.x *
            inverseForwardLength
          ) *
            (
              dx *
              inverseDistance
            ) +
          (
            agentForwardDir.y *
            inverseForwardLength
          ) *
            (
              dy *
              inverseDistance
            ) +
          (
            agentForwardDir.z *
            inverseForwardLength
          ) *
            (
              dz *
              inverseDistance
            );

        const halfFovDegrees =
          Math.min(
            180,
            Math.max(
              0,
              config
                .visionAngleDegrees ??
                90,
            ),
          ) *
          0.5;

        /*
         * Evita Math.acos() no hot-loop.
         *
         * Se dot >= cos(meio FOV),
         * então o alvo está dentro do cone.
         */
        const minimumDot =
          Math.cos(
            halfFovDegrees *
              (
                Math.PI /
                180
              ),
          );

        if (
          dot >=
          minimumDot
        ) {
          if (
            config
              .checkLineOfSight !==
              false &&
            physics
          ) {
            this.rayOrigin.x =
              agentPos.x;

            this.rayOrigin.y =
              agentPos.y;

            this.rayOrigin.z =
              agentPos.z;

            this.rayDirection.x =
              dx *
              inverseDistance;

            this.rayDirection.y =
              dy *
              inverseDistance;

            this.rayDirection.z =
              dz *
              inverseDistance;

            this.rayRequest.maxDistance =
              distance;

            const hit =
              physics.castRay(
                this.rayRequest,
              );

            if (
              !hit.hit ||
              hit.distance >=
                distance -
                  0.05
            ) {
              return this.writeResult(
                true,
                "vision",
                targetPos,
              );
            }
          } else {
            return this.writeResult(
              true,
              "vision",
              targetPos,
            );
          }
        }
      }
    }

    const hearingRadius =
      this.sanitizeNonNegative(
        config.hearingRadius ??
          10,
      );

    if (
      distanceSquared <=
      hearingRadius *
        hearingRadius
    ) {
      return this.writeResult(
        true,
        "hearing",
        targetPos,
      );
    }

    return this.writeResult(
      false,
      "none",
    );
  }

  private writeResult(
    targetSpotted:
      boolean,
    senseType:
      PerceptionSenseType,
    target?:
      Vector3AI,
  ): PerceptionResult {
    this.result.targetSpotted =
      targetSpotted;

    this.result.senseType =
      senseType;

    if (target) {
      this.targetScratch.x =
        target.x;

      this.targetScratch.y =
        target.y;

      this.targetScratch.z =
        target.z;

      this.result.targetPosition =
        this.targetScratch;
    } else {
      delete this.result
        .targetPosition;
    }

    return this.result;
  }

  private sanitizeNonNegative(
    value: number,
  ): number {
    if (
      !Number.isFinite(
        value,
      )
    ) {
      return 0;
    }

    return Math.max(
      0,
      value,
    );
  }
}