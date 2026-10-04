import * as THREE from "three";

import type {
  CameraShakeConfig,
} from "../../../contracts/camera/types";

export interface CameraShakeSnapshot {
  readonly positionOffset:
    THREE.Vector3;

  readonly rotationOffset:
    THREE.Euler;
}

export class TraumaCameraShake {
  private trauma =
    0;

  private timeAccumulator =
    0;

  private readonly scratchOffset =
    new THREE.Vector3();

  private readonly scratchRotation =
    new THREE.Euler();

  private readonly snapshot:
    CameraShakeSnapshot = {
      positionOffset:
        this.scratchOffset,

      rotationOffset:
        this.scratchRotation,
    };

  public constructor(
    private readonly config:
      CameraShakeConfig = {},
  ) {}

  public get currentTrauma():
    number {
    return this.trauma;
  }

  public addTrauma(
    amount:
      number,
  ): void {
    if (
      !Number.isFinite(
        amount,
      )
    ) {
      return;
    }

    const maxTrauma =
      Math.max(
        0,
        this.config
          .maxTrauma ??
          1,
      );

    this.trauma =
      Math.min(
        maxTrauma,
        Math.max(
          0,
          this.trauma +
            amount,
        ),
      );
  }

  public update(
    deltaSeconds:
      number,
  ): CameraShakeSnapshot {
    const safeDelta =
      Number.isFinite(
        deltaSeconds,
      )
        ? Math.max(
            0,
            deltaSeconds,
          )
        : 0;

    const decay =
      Math.max(
        0,
        this.config
          .traumaDecayRate ??
          1.2,
      );

    this.trauma =
      Math.max(
        0,
        this.trauma -
          decay *
            safeDelta,
      );

    if (
      this.trauma <=
      0
    ) {
      this.scratchOffset.set(
        0,
        0,
        0,
      );

      this.scratchRotation.set(
        0,
        0,
        0,
      );

      return this.snapshot;
    }

    const shake =
      this.trauma *
      this.trauma;

    const frequency =
      Math.max(
        0,
        this.config
          .frequencyHz ??
          25,
      );

    this.timeAccumulator +=
      safeDelta *
      frequency;

    const maxTranslation =
      this.config
        .maxTranslationOffset ?? {
        x: 0.3,
        y: 0.3,
        z: 0.2,
      };

    const maxRotation =
      this.config
        .maxPitchYawRollDegrees ?? {
        x: 4,
        y: 4,
        z: 6,
      };

    const noiseX =
      Math.sin(
        this.timeAccumulator *
          1.1,
      ) *
      Math.cos(
        this.timeAccumulator *
          0.7,
      );

    const noiseY =
      Math.cos(
        this.timeAccumulator *
          1.3,
      ) *
      Math.sin(
        this.timeAccumulator *
          0.9,
      );

    const noiseZ =
      Math.sin(
        this.timeAccumulator *
          1.7,
      );

    const noisePitch =
      Math.sin(
        this.timeAccumulator *
          0.8,
      );

    const noiseYaw =
      Math.cos(
        this.timeAccumulator *
          1.2,
      );

    const noiseRoll =
      Math.sin(
        this.timeAccumulator *
          1.5,
      );

    this.scratchOffset.set(
      maxTranslation.x *
        shake *
        noiseX,

      maxTranslation.y *
        shake *
        noiseY,

      maxTranslation.z *
        shake *
        noiseZ,
    );

    const degreesToRadians =
      Math.PI /
      180;

    this.scratchRotation.set(
      maxRotation.x *
        shake *
        noisePitch *
        degreesToRadians,

      maxRotation.y *
        shake *
        noiseYaw *
        degreesToRadians,

      maxRotation.z *
        shake *
        noiseRoll *
        degreesToRadians,
    );

    return this.snapshot;
  }

  public reset(): void {
    this.trauma =
      0;

    this.timeAccumulator =
      0;

    this.scratchOffset.set(
      0,
      0,
      0,
    );

    this.scratchRotation.set(
      0,
      0,
      0,
    );
  }
}