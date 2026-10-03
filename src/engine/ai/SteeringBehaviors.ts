import type {
  Vector3AI,
} from "../../contracts/ai/types";

interface MutableVector3AI {
  x: number;
  y: number;
  z: number;
}

export class SteeringBehaviors {
  private readonly scratchForce:
    MutableVector3AI = {
      x: 0,
      y: 0,
      z: 0,
    };

  public seek(
    currentPos:
      Vector3AI,
    currentVelocity:
      Vector3AI,
    targetPos:
      Vector3AI,
    maxSpeed:
      number,
    maxForce:
      number,
  ): Readonly<Vector3AI> {
    return this.calculateSteering(
      currentPos,
      currentVelocity,
      targetPos,
      this.sanitizeNonNegative(
        maxSpeed,
      ),
      this.sanitizeNonNegative(
        maxForce,
      ),
      0,
      false,
    );
  }

  public arrive(
    currentPos:
      Vector3AI,
    currentVelocity:
      Vector3AI,
    targetPos:
      Vector3AI,
    maxSpeed:
      number,
    maxForce:
      number,
    slowingDistance:
      number,
  ): Readonly<Vector3AI> {
    return this.calculateSteering(
      currentPos,
      currentVelocity,
      targetPos,
      this.sanitizeNonNegative(
        maxSpeed,
      ),
      this.sanitizeNonNegative(
        maxForce,
      ),
      this.sanitizeNonNegative(
        slowingDistance,
      ),
      true,
    );
  }

  private calculateSteering(
    currentPos:
      Vector3AI,
    currentVelocity:
      Vector3AI,
    targetPos:
      Vector3AI,
    maxSpeed:
      number,
    maxForce:
      number,
    slowingDistance:
      number,
    useArrival:
      boolean,
  ): Readonly<Vector3AI> {
    const dx =
      targetPos.x -
      currentPos.x;

    const dy =
      targetPos.y -
      currentPos.y;

    const dz =
      targetPos.z -
      currentPos.z;

    const distance =
      Math.sqrt(
        dx * dx +
        dy * dy +
        dz * dz,
      );

    if (
      distance <=
        0.000001 ||
      maxForce <=
        0
    ) {
      this.scratchForce.x =
        0;

      this.scratchForce.y =
        0;

      this.scratchForce.z =
        0;

      return this.scratchForce;
    }

    let desiredSpeed =
      maxSpeed;

    if (
      useArrival &&
      slowingDistance >
        0 &&
      distance <
        slowingDistance
    ) {
      desiredSpeed =
        maxSpeed *
        (
          distance /
          slowingDistance
        );
    }

    const inverseDistance =
      1 /
      distance;

    let forceX =
      dx *
        inverseDistance *
        desiredSpeed -
      currentVelocity.x;

    let forceY =
      dy *
        inverseDistance *
        desiredSpeed -
      currentVelocity.y;

    let forceZ =
      dz *
        inverseDistance *
        desiredSpeed -
      currentVelocity.z;

    const forceLength =
      Math.sqrt(
        forceX *
          forceX +
        forceY *
          forceY +
        forceZ *
          forceZ,
      );

    if (
      forceLength >
        maxForce &&
      forceLength >
        0.000001
    ) {
      const scale =
        maxForce /
        forceLength;

      forceX *=
        scale;

      forceY *=
        scale;

      forceZ *=
        scale;
    }

    this.scratchForce.x =
      forceX;

    this.scratchForce.y =
      forceY;

    this.scratchForce.z =
      forceZ;

    return this.scratchForce;
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