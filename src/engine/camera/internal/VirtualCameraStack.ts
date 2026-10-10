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

/** Blend usado quando nem a chamada nem o descritor definem duração. */
export const DEFAULT_CAMERA_BLEND_SECONDS =
  0.5;

export interface ActiveVirtualCameraState {
  descriptor:
    VirtualCameraDescriptor;

  springArm:
    SpringArm3D | null;

  /**
   * Shake GLOBAL da pilha (mesma instância em todas as câmeras, G48).
   */
  readonly shake:
    TraumaCameraShake;

  priority:
    number;

  /** Alvo manual (`setFollowTarget`), copiado (G48). */
  readonly manualFollow:
    THREE.Vector3;

  hasManualFollow:
    boolean;

  /** Última posição lida do corpo `followTargetId` (G47). */
  readonly entityFollow:
    THREE.Vector3;

  hasEntityFollow:
    boolean;

  readonly manualLookAt:
    THREE.Vector3;

  hasManualLookAt:
    boolean;

  readonly entityLookAt:
    THREE.Vector3;

  hasEntityLookAt:
    boolean;
}

export interface VirtualCameraTransform {
  readonly position:
    THREE.Vector3;

  readonly rotation:
    THREE.Quaternion;

  fov:
    number;
}

interface MutableBodyTransform {
  readonly position: { x: number; y: number; z: number };
  readonly rotation: { x: number; y: number; z: number; w: number };
}

function finitePriority(
  value: number,
): number {
  return Number.isFinite(
    value,
  )
    ? value
    : 0;
}

export class VirtualCameraStack {
  private readonly cameras =
    new Map<
      string,
      ActiveVirtualCameraState
    >();

  private readonly shake =
    new TraumaCameraShake();

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

  private readonly bodyScratch:
    MutableBodyTransform = {
      position: {
        x:
          0,
        y:
          0,
        z:
          0,
      },
      rotation: {
        x:
          0,
        y:
          0,
        z:
          0,
        w:
          1,
      },
    };

  private readonly lookMatrix =
    new THREE.Matrix4();

  private readonly up =
    new THREE.Vector3(
      0,
      1,
      0,
    );

  private readonly targetScratch =
    new THREE.Vector3();

  /**
   * Registra/substitui. Retorna true se a câmera ficou ATIVA por causa do
   * registro (primeira câmera ou prioridade maior que a ativa, G46).
   */
  public registerCamera(
    descriptor:
      VirtualCameraDescriptor,
  ): boolean {
    const existing =
      this.cameras.get(
        descriptor.id,
      );

    const springArm =
      descriptor.springArmConfig
        ? new SpringArm3D(
            descriptor.springArmConfig,
          )
        : null;

    if (
      existing !==
      undefined
    ) {
      // Re-registro preserva alvos, trauma global e status de ativa (G4/G48).
      existing.descriptor =
        descriptor;
      existing.springArm =
        springArm;
      existing.priority =
        finitePriority(
          descriptor.priority,
        );
      existing.hasEntityFollow =
        false;
      existing.hasEntityLookAt =
        false;

      if (
        this.activeCameraId ===
        descriptor.id
      ) {
        this.shake.setConfig(
          descriptor.shakeConfig ??
            {},
        );
      }
    } else {
      this.cameras.set(
        descriptor.id,
        {
          descriptor,
          springArm,
          shake:
            this.shake,
          priority:
            finitePriority(
              descriptor.priority,
            ),
          manualFollow:
            new THREE.Vector3(),
          hasManualFollow:
            false,
          entityFollow:
            new THREE.Vector3(),
          hasEntityFollow:
            false,
          manualLookAt:
            new THREE.Vector3(),
          hasManualLookAt:
            false,
          entityLookAt:
            new THREE.Vector3(),
          hasEntityLookAt:
            false,
        },
      );
    }

    if (
      this.activeCameraId ===
      null
    ) {
      // Primeira câmera: corte direto.
      this.setActiveCamera(
        descriptor.id,
        0,
      );
      return true;
    }

    if (
      this.activeCameraId ===
      descriptor.id
    ) {
      return this.reevaluateActivePriority();
    }

    const active =
      this.getActiveCameraState();

    if (
      active !==
        null &&
      finitePriority(
        descriptor.priority,
      ) >
        active.priority
    ) {
      return this.setActiveCamera(
        descriptor.id,
      );
    }

    return false;
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
      this.finishBlend();
    }

    if (
      this.activeCameraId ===
      cameraId
    ) {
      this.activeCameraId =
        this.getHighestPriorityCameraId();

      this.finishBlend();

      const next =
        this.getActiveCameraState();

      if (
        next !==
        null
      ) {
        this.shake.setConfig(
          next.descriptor.shakeConfig ??
            {},
        );
      }
    }

    return true;
  }

  /**
   * Ativa a câmera. Sem duração usa `descriptor.blendDurationSeconds` da
   * câmera de destino (padrão 0,5 s, G47).
   */
  public setActiveCamera(
    cameraId: string,
    blendDurationSeconds?: number,
  ): boolean {
    const target =
      this.cameras.get(
        cameraId,
      );

    if (
      target ===
      undefined
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
        this.resolveBlendDuration(
          cameraId,
          blendDurationSeconds,
        ),
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

    this.shake.setConfig(
      target.descriptor.shakeConfig ??
        {},
    );

    return true;
  }

  /** Duração efetiva que `setActiveCamera` usaria. */
  public resolveBlendDuration(
    cameraId: string,
    blendDurationSeconds?: number,
  ): number {
    if (
      blendDurationSeconds !==
      undefined
    ) {
      return blendDurationSeconds;
    }

    const descriptorBlend =
      this.cameras.get(
        cameraId,
      )?.descriptor
        .blendDurationSeconds;

    return descriptorBlend !==
      undefined &&
      Number.isFinite(
        descriptorBlend,
      )
      ? descriptorBlend
      : DEFAULT_CAMERA_BLEND_SECONDS;
  }

  /**
   * Muda a prioridade e reavalia a câmera ativa (G46). Retorna false se a
   * câmera não existe.
   */
  public setCameraPriority(
    cameraId: string,
    priority: number,
  ): boolean {
    const camera =
      this.cameras.get(
        cameraId,
      );

    if (
      camera ===
      undefined
    ) {
      return false;
    }

    camera.priority =
      finitePriority(
        priority,
      );

    if (
      this.activeCameraId ===
      cameraId
    ) {
      this.reevaluateActivePriority();
      return true;
    }

    const active =
      this.getActiveCameraState();

    if (
      active ===
        null ||
      camera.priority >
        active.priority
    ) {
      this.setActiveCamera(
        cameraId,
      );
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

  public getCameraCount():
    number {
    return this.cameras.size;
  }

  public getShake():
    TraumaCameraShake {
    return this.shake;
  }

  /** Copia os números do alvo (nunca guarda a referência, G48). */
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

    camera.manualFollow.set(
      targetPos.x,
      targetPos.y,
      targetPos.z,
    );

    camera.hasManualFollow =
      Number.isFinite(
        targetPos.x,
      ) &&
      Number.isFinite(
        targetPos.y,
      ) &&
      Number.isFinite(
        targetPos.z,
      );

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

    camera.hasManualFollow =
      false;

    return true;
  }

  public setLookAtTarget(
    cameraId: string,
    targetPos:
      Vector3Camera | null,
  ): boolean {
    const camera =
      this.cameras.get(
        cameraId,
      );

    if (!camera) {
      return false;
    }

    if (
      targetPos ===
      null
    ) {
      camera.hasManualLookAt =
        false;
      return true;
    }

    camera.manualLookAt.set(
      targetPos.x,
      targetPos.y,
      targetPos.z,
    );

    camera.hasManualLookAt =
      Number.isFinite(
        targetPos.x,
      ) &&
      Number.isFinite(
        targetPos.y,
      ) &&
      Number.isFinite(
        targetPos.z,
      );

    return true;
  }

  /**
   * Alvo de seguimento efetivo da câmera (manual > entidade) ou null.
   * Retorna um vetor INTERNO (não guarde).
   */
  public getEffectiveFollowTarget(
    state:
      ActiveVirtualCameraState,
  ): THREE.Vector3 | null {
    if (
      state.hasManualFollow
    ) {
      return state.manualFollow;
    }

    return state.hasEntityFollow
      ? state.entityFollow
      : null;
  }

  public getEffectiveLookAtTarget(
    state:
      ActiveVirtualCameraState,
  ): THREE.Vector3 | null {
    if (
      state.hasManualLookAt
    ) {
      return state.manualLookAt;
    }

    return state.hasEntityLookAt
      ? state.entityLookAt
      : null;
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

    let blended =
      false;

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

        blended =
          true;
      } else {
        this.finishBlend();
      }
    }

    if (
      !blended
    ) {
      this.copyTransform(
        this.currentTransform,
        this.finalTransform,
      );
    }

    // Shake global aplicado depois do blend (G48).
    this.applyShake(
      safeDelta,
      this.finalTransform,
    );

    return this.finalTransform;
  }

  public clear(): void {
    this.shake.reset();

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

  private reevaluateActivePriority(): boolean {
    const active =
      this.getActiveCameraState();

    const highestId =
      this.getHighestPriorityCameraId();

    if (
      active ===
        null ||
      highestId ===
        null ||
      highestId ===
        this.activeCameraId
    ) {
      return false;
    }

    const highest =
      this.cameras.get(
        highestId,
      );

    if (
      highest !==
        undefined &&
      highest.priority >
        active.priority
    ) {
      this.setActiveCamera(
        highestId,
      );
    }

    return false;
  }

  private readEntityPosition(
    entityId: string,
    physics:
      PhysicsApi | null,
    out:
      THREE.Vector3,
  ): boolean {
    if (
      physics ===
        null ||
      typeof physics.getBodyTransformInto !==
        "function" ||
      !physics.getBodyTransformInto(
        entityId,
        this.bodyScratch,
      )
    ) {
      return false;
    }

    out.set(
      this.bodyScratch.position.x,
      this.bodyScratch.position.y,
      this.bodyScratch.position.z,
    );

    return true;
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

    // G47: alvos por id de entidade, lidos da física a cada frame (a
    // última posição conhecida é mantida se o corpo sumir).
    if (
      descriptor.followTargetId !==
        undefined &&
      this.readEntityPosition(
        descriptor.followTargetId,
        physics,
        state.entityFollow,
      )
    ) {
      state.hasEntityFollow =
        true;
    }

    if (
      descriptor.lookAtTargetId !==
        undefined &&
      this.readEntityPosition(
        descriptor.lookAtTargetId,
        physics,
        state.entityLookAt,
      )
    ) {
      state.hasEntityLookAt =
        true;
    }

    const followTarget =
      this.getEffectiveFollowTarget(
        state,
      );

    if (
      followTarget !==
      null
    ) {
      if (
        state.springArm
      ) {
        const springArmPosition =
          state.springArm
            .computeCameraPosition(
              followTarget,
              output.rotation,
              physics,
              this.lastDeltaSeconds,
              descriptor.followTargetId,
            );

        output.position.copy(
          springArmPosition,
        );
      } else {
        // Sem spring-arm: `position` é o offset em relação ao alvo.
        output.position.set(
          followTarget.x +
            descriptor.position.x,
          followTarget.y +
            descriptor.position.y,
          followTarget.z +
            descriptor.position.z,
        );
      }
    } else {
      // G46: sem alvo a câmera fica em `position` (nunca usa position como alvo).
      output.position.set(
        descriptor.position.x,
        descriptor.position.y,
        descriptor.position.z,
      );
    }

    const lookAtTarget =
      this.getEffectiveLookAtTarget(
        state,
      );

    if (
      lookAtTarget !==
        null &&
      output.position
        .distanceToSquared(
          lookAtTarget,
        ) >
        0.000001
    ) {
      this.targetScratch.copy(
        lookAtTarget,
      );

      // Matrix4.lookAt(eye, target, up) orienta -Z para o alvo (convenção de câmera).
      this.lookMatrix.lookAt(
        output.position,
        this.targetScratch,
        this.up,
      );

      output.rotation
        .setFromRotationMatrix(
          this.lookMatrix,
        );
    }

    output.fov =
      Number.isFinite(
        descriptor.fov,
      ) &&
      descriptor.fov >
        0 &&
      descriptor.fov <
        180
        ? descriptor.fov
        : 60;
  }

  private applyShake(
    deltaSeconds: number,
    transform:
      VirtualCameraTransform,
  ): void {
    const shake =
      this.shake.update(
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
        camera.priority >
          highest.priority
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
