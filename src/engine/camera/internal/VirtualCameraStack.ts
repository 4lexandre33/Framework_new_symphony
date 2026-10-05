import * as THREE from "three";

import type {
  Vector3Camera,
  VirtualCameraDescriptor,
} from "../../../contracts/camera/types";

import type {
  PhysicsApi,
} from "../../../tokens/physics";

import {
  SpringArm3D,
} from "./SpringArm3D";

import {
  TraumaCameraShake,
} from "./TraumaCameraShake";

export interface ActiveVirtualCameraState {
  readonly descriptor:
    VirtualCameraDescriptor;

  readonly springArm:
    SpringArm3D | null;

  readonly shake:
    TraumaCameraShake;

  followTargetPos:
    Vector3Camera | null;
}

export interface VirtualCameraTransform {
  readonly position:
    THREE.Vector3;

  readonly rotation:
    THREE.Quaternion;

  fov:
    number;
}

export class VirtualCameraStack {
  private readonly cameras =
    new Map<
      string,
      ActiveVirtualCameraState
    >();

  private activeCameraId:
    string | null =
      null;

  private previousCameraId:
    string | null =
      null;

  private isBlending =
    false;

  private blendDuration =
    0;

  private blendProgress =
    0;

  private readonly currentTransform:
    VirtualCameraTransform = {
      position:
        new THREE.Vector3(),

      rotation:
        new THREE.Quaternion(),

      fov:
        60,
    };

  private readonly previousTransform:
    VirtualCameraTransform = {
      position:
        new THREE.Vector3(),

      rotation:
        new THREE.Quaternion(),

      fov:
        60,
    };

  private readonly finalTransform:
    VirtualCameraTransform = {
      position:
        new THREE.Vector3(),

      rotation:
        new THREE.Quaternion(),

      fov:
        60,
    };

  private lastDeltaSeconds =
    0;

  private readonly shakeRotation =
    new THREE.Quaternion();

  public registerCamera(
    descriptor:
      VirtualCameraDescriptor,
  ): void {
    const springArm =
      descriptor.springArmConfig
        ? new SpringArm3D(
            descriptor.springArmConfig,
          )
        : null;

    const shake =
      new TraumaCameraShake(
        descriptor.shakeConfig ??
          {},
      );

    const state:
      ActiveVirtualCameraState = {
        descriptor,

        springArm,

        shake,

        followTargetPos:
          descriptor.position,
      };

    this.cameras.set(
      descriptor.id,
      state,
    );

    if (
      this.activeCameraId ===
      null
    ) {
      this.activeCameraId =
        descriptor.id;
    }
  }

  public unregisterCamera(
    cameraId: string,
  ): boolean {
    const removed =
      this.cameras.delete(
        cameraId,
      );

    if (!removed) {
      return false;
    }

    if (
      this.previousCameraId ===
      cameraId
    ) {
      this.previousCameraId =
        null;

      this.isBlending =
        false;

      this.blendDuration =
        0;

      this.blendProgress =
        0;
    }

    if (
      this.activeCameraId ===
      cameraId
    ) {
      this.activeCameraId =
        this.getHighestPriorityCameraId();

      this.previousCameraId =
        null;

      this.isBlending =
        false;

      this.blendDuration =
        0;

      this.blendProgress =
        0;
    }

    return true;
  }

  public setActiveCamera(
    cameraId: string,
    blendDurationSeconds =
      0.5,
  ): boolean {
    if (
      !this.cameras.has(
        cameraId,
      )
    ) {
      return false;
    }

    if (
      this.activeCameraId ===
      cameraId
    ) {
      return true;
    }

    const safeBlendDuration =
      this.sanitizeNonNegative(
        blendDurationSeconds,
      );

    this.previousCameraId =
      this.activeCameraId;

    this.activeCameraId =
      cameraId;

    this.blendDuration =
      safeBlendDuration;

    this.blendProgress =
      0;

    this.isBlending =
      this.previousCameraId !==
        null &&
      safeBlendDuration >
        0;

    if (
      !this.isBlending
    ) {
      this.previousCameraId =
        null;
    }

    return true;
  }

  public getActiveCameraState():
    ActiveVirtualCameraState | null {
    if (
      this.activeCameraId ===
      null
    ) {
      return null;
    }

    return (
      this.cameras.get(
        this.activeCameraId,
      ) ??
      null
    );
  }

  public getCameraState(
    cameraId: string,
  ): ActiveVirtualCameraState | null {
    return (
      this.cameras.get(
        cameraId,
      ) ??
      null
    );
  }

  public getActiveCameraId():
    string | null {
    return this.activeCameraId;
  }

  public setFollowTarget(
    cameraId: string,
    targetPos:
      Vector3Camera,
  ): boolean {
    const camera =
      this.cameras.get(
        cameraId,
      );

    if (!camera) {
      return false;
    }

    camera.followTargetPos =
      targetPos;

    return true;
  }

  public clearFollowTarget(
    cameraId: string,
  ): boolean {
    const camera =
      this.cameras.get(
        cameraId,
      );

    if (!camera) {
      return false;
    }

    camera.followTargetPos =
      null;

    return true;
  }

  public update(
    deltaSeconds: number,
    physics:
      PhysicsApi | null =
        null,
  ): Readonly<VirtualCameraTransform> {
    const safeDelta =
      this.sanitizeDelta(
        deltaSeconds,
      );

    this.lastDeltaSeconds =
      safeDelta;

    const activeState =
      this.getActiveCameraState();

    if (!activeState) {
      this.finalTransform
        .position.set(
          0,
          5,
          10,
        );

      this.finalTransform
        .rotation.identity();

      this.finalTransform.fov =
        60;

      return this.finalTransform;
    }

    this.computeSingleCameraTransform(
      activeState,
      physics,
      this.currentTransform,
    );

    this.applyShake(
      activeState,
      safeDelta,
      this.currentTransform,
    );

    if (
      this.isBlending &&
      this.previousCameraId
    ) {
      const previousState =
        this.cameras.get(
          this.previousCameraId,
        );

      if (previousState) {
        this.computeSingleCameraTransform(
          previousState,
          physics,
          this.previousTransform,
        );

        this.blendProgress +=
          safeDelta;

        const alpha =
          this.blendDuration >
          0
            ? Math.min(
                1,
                this.blendProgress /
                  this.blendDuration,
              )
            : 1;

        this.finalTransform
          .position.lerpVectors(
            this.previousTransform
              .position,
            this.currentTransform
              .position,
            alpha,
          );

        this.finalTransform
          .rotation
          .slerpQuaternions(
            this.previousTransform
              .rotation,
            this.currentTransform
              .rotation,
            alpha,
          )
          .normalize();

        this.finalTransform.fov =
          this.previousTransform
            .fov +
          (
            this.currentTransform
              .fov -
            this.previousTransform
              .fov
          ) *
            alpha;

        if (
          alpha >=
          1
        ) {
          this.finishBlend();
        }

        return this.finalTransform;
      }

      this.finishBlend();
    }

    this.copyTransform(
      this.currentTransform,
      this.finalTransform,
    );

    return this.finalTransform;
  }

  public clear(): void {
    for (
      const camera of
      this.cameras.values()
    ) {
      camera.shake.reset();
    }

    this.cameras.clear();

    this.activeCameraId =
      null;

    this.previousCameraId =
      null;

    this.isBlending =
      false;

    this.blendDuration =
      0;

    this.blendProgress =
      0;

    this.currentTransform
      .position.set(
        0,
        0,
        0,
      );

    this.currentTransform
      .rotation.identity();

    this.currentTransform.fov =
      60;

    this.previousTransform
      .position.set(
        0,
        0,
        0,
      );

    this.previousTransform
      .rotation.identity();

    this.previousTransform.fov =
      60;

    this.finalTransform
      .position.set(
        0,
        0,
        0,
      );

    this.finalTransform
      .rotation.identity();

    this.finalTransform.fov =
      60;
  }

  private computeSingleCameraTransform(
    state:
      ActiveVirtualCameraState,
    physics:
      PhysicsApi | null,
    output:
      VirtualCameraTransform,
  ): void {
    const descriptor =
      state.descriptor;

    output.rotation.set(
      descriptor.rotation.x,
      descriptor.rotation.y,
      descriptor.rotation.z,
      descriptor.rotation.w,
    );

    if (
      output.rotation
        .lengthSq() <=
      0.000001
    ) {
      output.rotation.identity();
    } else {
      output.rotation.normalize();
    }

    if (
      state.springArm &&
      state.followTargetPos
    ) {
      const springArmPosition =
        state.springArm
          .computeCameraPosition(
            state.followTargetPos,
            output.rotation,
            physics,
            this.lastDeltaSeconds,
          );

      output.position.copy(
        springArmPosition,
      );
    } else {
      output.position.set(
        descriptor.position.x,
        descriptor.position.y,
        descriptor.position.z,
      );
    }

    output.fov =
      Number.isFinite(
        descriptor.fov,
      )
        ? descriptor.fov
        : 60;
  }

  private applyShake(
    state:
      ActiveVirtualCameraState,
    deltaSeconds: number,
    transform:
      VirtualCameraTransform,
  ): void {
    const shake =
      state.shake.update(
        deltaSeconds,
      );

    transform.position.add(
      shake.positionOffset,
    );

    this.shakeRotation
      .setFromEuler(
        shake.rotationOffset,
      );

    transform.rotation
      .multiply(
        this.shakeRotation,
      )
      .normalize();
  }

  private copyTransform(
    source:
      VirtualCameraTransform,
    target:
      VirtualCameraTransform,
  ): void {
    target.position.copy(
      source.position,
    );

    target.rotation.copy(
      source.rotation,
    );

    target.fov =
      source.fov;
  }

  private finishBlend(): void {
    this.isBlending =
      false;

    this.previousCameraId =
      null;

    this.blendDuration =
      0;

    this.blendProgress =
      0;
  }

  private getHighestPriorityCameraId():
    string | null {
    let highest:
      ActiveVirtualCameraState | null =
        null;

    for (
      const camera of
      this.cameras.values()
    ) {
      if (
        !highest ||
        camera.descriptor
          .priority >
          highest.descriptor
            .priority
      ) {
        highest =
          camera;
      }
    }

    return (
      highest?.descriptor.id ??
      null
    );
  }

  private sanitizeDelta(
    deltaSeconds: number,
  ): number {
    if (
      !Number.isFinite(
        deltaSeconds,
      ) ||
      deltaSeconds <=
        0
    ) {
      return 0;
    }

    return deltaSeconds;
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