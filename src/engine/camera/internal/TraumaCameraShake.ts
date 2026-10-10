import * as THREE from "three";

import type {
  CameraShakeConfig,
  Vector3Camera,
} from "../../../contracts/camera/types";

export interface CameraShakeSnapshot {
  readonly positionOffset:
    THREE.Vector3;

  readonly rotationOffset:
    THREE.Euler;
}

const DEFAULT_TRANSLATION:
  Readonly<Vector3Camera> =
    Object.freeze({
      x:
        0.3,
      y:
        0.3,
      z:
        0.2,
    });

const DEFAULT_ROTATION_DEGREES:
  Readonly<Vector3Camera> =
    Object.freeze({
      x:
        4,
      y:
        4,
      z:
        6,
    });

const DEGREES_TO_RADIANS =
  Math.PI /
  180;

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
    private config:
      CameraShakeConfig = {},
  ) {}

  /**
   * Troca os parâmetros do ruído sem zerar o trauma acumulado (G48).
   */
  public setConfig(
    config:
      CameraShakeConfig,
  ): void {
    this.config =
      config;

    const maxTrauma =
      Math.max(
        0,
        config.maxTrauma ??
          1,
      );

    if (
      this.trauma >
      maxTrauma
    ) {
      this.trauma =
        maxTrauma;
    }
  }

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
    const elapsedDelta =
      Number.isFinite(
        deltaSeconds,
      )
        ? Math.max(
            0,
            deltaSeconds,
          )
        : 0;

    const phaseDelta =
      Math.min(
        0.25,
        elapsedDelta,
      );

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
            elapsedDelta,
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
      phaseDelta *
      frequency;

    const maxTranslation =
      this.config
        .maxTranslationOffset ??
      DEFAULT_TRANSLATION;

    const maxRotation =
      this.config
        .maxPitchYawRollDegrees ??
      DEFAULT_ROTATION_DEGREES;

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

    this.scratchRotation.set(
      maxRotation.x *
        shake *
        noisePitch *
        DEGREES_TO_RADIANS,
      maxRotation.y *
        shake *
        noiseYaw *
        DEGREES_TO_RADIANS,
      maxRotation.z *
        shake *
        noiseRoll *
        DEGREES_TO_RADIANS,
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
