import * as THREE from "three";

import type {
  PluginContext,
} from "@core";

import type {
  CameraApi,
} from "../../../tokens/camera";

import type {
  PhysicsApi,
} from "../../../tokens/physics";

import type {
  Render3DApi,
} from "../../../tokens/render";

import {
  CameraCollisionEvent,
  CameraOcclusionChangedEvent,
  CameraShakeTriggeredEvent,
  CameraStateChangedEvent,
} from "../../../contracts/camera/types";

import type {
  CameraTransformSnapshot,
  SpringArmConfig,
  Vector3Camera,
  VirtualCameraDescriptor,
} from "../../../contracts/camera/types";

import {
  VirtualCameraStack,
} from "./VirtualCameraStack";

import {
  CameraOcclusionDetector,
} from "./CameraOcclusionDetector";

export class CameraService
  implements CameraApi {
  private readonly stack =
    new VirtualCameraStack();

  private lastCollisionCameraId:
    string | null =
      null;

  private lastCollisionState =
    false;

  private physics:
    PhysicsApi | null =
      null;

  private renderApi:
    Render3DApi | null =
      null;

  private disposed =
    false;

  // G4: com false a câmera do render não é tocada.
  private enabled =
    true;

  private readonly occlusionDetector =
    new CameraOcclusionDetector();

  private readonly lastOccluded =
    new Set<string>();

  private lastOcclusionCameraId:
    string | null =
      null;

  public constructor(
    private readonly ctx:
      PluginContext,
  ) {}

  public bindDependencies(
    physics:
      PhysicsApi,
    renderApi:
      Render3DApi,
  ): void {
    if (
      this.disposed
    ) {
      return;
    }

    this.physics =
      physics;

    this.renderApi =
      renderApi;
  }

  public registerVirtualCamera(
    descriptor:
      VirtualCameraDescriptor,
  ): void {
    if (
      this.disposed
    ) {
      return;
    }

    const previousCameraId =
      this.stack
        .getActiveCameraId();

    this.stack
      .registerCamera(
        descriptor,
      );

    this.emitActivationIfChanged(
      previousCameraId,
    );
  }

  public unregisterVirtualCamera(
    cameraId:
      string,
  ): boolean {
    if (
      this.disposed
    ) {
      return false;
    }

    const previousCameraId =
      this.stack
        .getActiveCameraId();

    const removed =
      this.stack
        .unregisterCamera(
          cameraId,
        );

    if (
      removed
    ) {
      this.emitActivationIfChanged(
        previousCameraId,
        0,
      );
    }

    if (
      removed &&
      this.lastCollisionCameraId ===
        cameraId
    ) {
      this.lastCollisionCameraId =
        null;

      this.lastCollisionState =
        false;
    }

    return removed;
  }

  public setActiveCamera(
    cameraId:
      string,
    blendDurationSeconds?:
      number,
  ): boolean {
    if (
      this.disposed
    ) {
      return false;
    }

    const previousCameraId =
      this.stack
        .getActiveCameraId();

    // G47: sem duração explícita usa o blend do descritor de destino.
    const safeBlendDuration =
      this.sanitizeNonNegative(
        this.stack
          .resolveBlendDuration(
            cameraId,
            blendDurationSeconds,
          ),
      );

    const changed =
      previousCameraId !==
      cameraId;

    const activated =
      this.stack
        .setActiveCamera(
          cameraId,
          safeBlendDuration,
        );

    if (
      activated &&
      changed
    ) {
      this.ctx.events.emit(
        CameraStateChangedEvent.type,
        {
          activeCameraId:
            cameraId,

          previousCameraId,

          blendDurationSeconds:
            safeBlendDuration,
        },
      );
    }

    return activated;
  }

  public addTrauma(
    traumaAmount:
      number,
  ): void {
    if (
      this.disposed ||
      !Number.isFinite(
        traumaAmount,
      )
    ) {
      return;
    }

    const safeTrauma =
      Math.max(
        0,
        traumaAmount,
      );

    if (
      safeTrauma <=
      0
    ) {
      return;
    }

    // G48: trauma global, sobrevive à troca de câmera.
    const shake =
      this.stack
        .getShake();

    shake.addTrauma(
      safeTrauma,
    );

    this.ctx.events.emit(
      CameraShakeTriggeredEvent.type,
      {
        traumaAmount:
          safeTrauma,

        currentTotalTrauma:
          shake.currentTrauma,
      },
    );
  }

  public setFollowTarget(
    cameraId:
      string,
    targetPosition:
      Vector3Camera,
  ): void {
    if (
      this.disposed
    ) {
      return;
    }

    this.stack
      .setFollowTarget(
        cameraId,
        targetPosition,
      );
  }

  public configureSpringArm(
    cameraId:
      string,
    config:
      Partial<SpringArmConfig>,
  ): void {
    if (
      this.disposed
    ) {
      return;
    }

    const camera =
      this.stack
        .getCameraState(
          cameraId,
        );

    if (
      camera ===
        null ||
      camera.springArm ===
        null
    ) {
      return;
    }

    camera.springArm
      .updateConfig(
        config,
      );
  }

  public clearFollowTarget(
    cameraId:
      string,
  ): boolean {
    if (
      this.disposed
    ) {
      return false;
    }

    return this.stack
      .clearFollowTarget(
        cameraId,
      );
  }

  public setLookAtTarget(
    cameraId:
      string,
    targetPosition:
      Vector3Camera | null,
  ): boolean {
    if (
      this.disposed
    ) {
      return false;
    }

    return this.stack
      .setLookAtTarget(
        cameraId,
        targetPosition,
      );
  }

  public setCameraPriority(
    cameraId:
      string,
    priority:
      number,
  ): boolean {
    if (
      this.disposed
    ) {
      return false;
    }

    const previousCameraId =
      this.stack
        .getActiveCameraId();

    const updated =
      this.stack
        .setCameraPriority(
          cameraId,
          priority,
        );

    if (
      updated
    ) {
      this.emitActivationIfChanged(
        previousCameraId,
      );
    }

    return updated;
  }

  public setEnabled(
    enabled:
      boolean,
  ): void {
    this.enabled =
      enabled ===
      true;
  }

  public isEnabled():
    boolean {
    return this.enabled;
  }

  public getTrauma():
    number {
    return this.stack
      .getShake()
      .currentTrauma;
  }

  public getActiveCameraId():
    string | null {
    if (
      this.disposed
    ) {
      return null;
    }

    return this.stack
      .getActiveCameraId();
  }

  public getCurrentCameraSnapshot():
    CameraTransformSnapshot | null {
    if (
      this.disposed
    ) {
      return null;
    }

    const active =
      this.stack
        .getActiveCameraState();

    if (
      active ===
      null
    ) {
      return null;
    }

    const renderCamera =
      this.renderApi
        ?.getActiveCamera();

    const position =
      renderCamera
        ?.position;

    const rotation =
      renderCamera
        ?.quaternion;

    const fov =
      renderCamera instanceof
        THREE.PerspectiveCamera
        ? renderCamera.fov
        : active.descriptor
            .fov;

    return {
      position: {
        x:
          position?.x ??
          active.descriptor
            .position.x,

        y:
          position?.y ??
          active.descriptor
            .position.y,

        z:
          position?.z ??
          active.descriptor
            .position.z,
      },

      rotation: {
        x:
          rotation?.x ??
          active.descriptor
            .rotation.x,

        y:
          rotation?.y ??
          active.descriptor
            .rotation.y,

        z:
          rotation?.z ??
          active.descriptor
            .rotation.z,

        w:
          rotation?.w ??
          active.descriptor
            .rotation.w,
      },

      fov,

      isColliding:
        active.springArm
          ?.isCurrentlyColliding ??
        false,

      currentArmLength:
        active.springArm
          ?.armLength ??
        0,

      currentTrauma:
        this.stack
          .getShake()
          .currentTrauma,
    };
  }

  public render(
    deltaSeconds:
      number,
  ): void {
    if (
      this.disposed
    ) {
      return;
    }

    const renderApi =
      this.renderApi;

    // G4: sem câmera virtual (ou desabilitado) a câmera do render é do jogo.
    if (
      renderApi ===
        null ||
      !this.enabled ||
      this.stack
        .getActiveCameraState() ===
        null
    ) {
      return;
    }

    const cameraTransform =
      this.stack.update(
        this.sanitizeDelta(
          deltaSeconds,
        ),
        this.physics,
      );

    const activeThreeCamera =
      renderApi
        .getActiveCamera();

    activeThreeCamera.position
      .copy(
        cameraTransform.position,
      );

    activeThreeCamera.quaternion
      .copy(
        cameraTransform.rotation,
      );

    if (
      activeThreeCamera instanceof
      THREE.PerspectiveCamera &&
      activeThreeCamera.fov !==
        cameraTransform.fov
    ) {
      activeThreeCamera.fov =
        cameraTransform.fov;

      activeThreeCamera
        .updateProjectionMatrix();
    }

    this.emitCollisionChangeIfNeeded();

    this.updateOcclusion(
      activeThreeCamera.position,
    );
  }

  public dispose(): void {
    if (
      this.disposed
    ) {
      return;
    }

    this.disposed =
      true;

    this.stack
      .clear();

    this.lastCollisionCameraId =
      null;

    this.lastCollisionState =
      false;

    this.lastOccluded
      .clear();

    this.lastOcclusionCameraId =
      null;

    this.physics =
      null;

    this.renderApi =
      null;
  }

  /**
   * Emite `game.camera.state-changed` quando a câmera ativa mudou por
   * registro/prioridade/remoção (G46).
   */
  private emitActivationIfChanged(
    previousCameraId:
      string | null,
    forcedBlendSeconds?:
      number,
  ): void {
    const activeCameraId =
      this.stack
        .getActiveCameraId();

    if (
      activeCameraId ===
        null ||
      activeCameraId ===
        previousCameraId
    ) {
      return;
    }

    const blendDurationSeconds =
      previousCameraId ===
        null
        ? 0
        : this.sanitizeNonNegative(
            forcedBlendSeconds ??
              this.stack
                .resolveBlendDuration(
                  activeCameraId,
                ),
          );

    this.ctx.events.emit(
      CameraStateChangedEvent.type,
      {
        activeCameraId,

        previousCameraId,

        blendDurationSeconds,
      },
    );
  }

  /**
   * Oclusão câmera→alvo (G47). Só roda para câmeras com
   * `detectOcclusion`; emite quando o conjunto muda.
   */
  private updateOcclusion(
    cameraPosition:
      Vector3Camera,
  ): void {
    const active =
      this.stack
        .getActiveCameraState();

    const physics =
      this.physics;

    if (
      active ===
        null ||
      active.descriptor
        .detectOcclusion !==
        true ||
      physics ===
        null
    ) {
      return;
    }

    const target =
      this.stack
        .getEffectiveLookAtTarget(
          active,
        ) ??
      this.stack
        .getEffectiveFollowTarget(
          active,
        );

    if (
      target ===
      null
    ) {
      return;
    }

    const occluded =
      this.occlusionDetector
        .checkOcclusion(
          cameraPosition,
          target,
          physics,
          active.descriptor
            .followTargetId ??
            active.descriptor
              .lookAtTargetId,
        );

    const cameraId =
      active.descriptor.id;

    let changed =
      this.lastOcclusionCameraId !==
        cameraId ||
      occluded.size !==
        this.lastOccluded.size;

    if (
      !changed
    ) {
      for (
        const entityId of
        occluded
      ) {
        if (
          !this.lastOccluded.has(
            entityId,
          )
        ) {
          changed =
            true;
          break;
        }
      }
    }

    if (
      !changed
    ) {
      return;
    }

    this.lastOcclusionCameraId =
      cameraId;

    this.lastOccluded.clear();

    for (
      const entityId of
      occluded
    ) {
      this.lastOccluded.add(
        entityId,
      );
    }

    this.ctx.events.emit(
      CameraOcclusionChangedEvent.type,
      {
        cameraId,

        occludedEntityIds:
          Array.from(
            occluded,
          ),
      },
    );
  }

  private emitCollisionChangeIfNeeded():
    void {
    const activeCameraId =
      this.stack
        .getActiveCameraId();

    const active =
      this.stack
        .getActiveCameraState();

    if (
      activeCameraId ===
        null ||
      active ===
        null ||
      active.springArm ===
        null
    ) {
      this.lastCollisionCameraId =
        activeCameraId;

      this.lastCollisionState =
        false;

      return;
    }

    const isColliding =
      active.springArm
        .isCurrentlyColliding;

    const cameraChanged =
      this.lastCollisionCameraId !==
      activeCameraId;

    const collisionChanged =
      this.lastCollisionState !==
      isColliding;

    if (
      !cameraChanged &&
      !collisionChanged
    ) {
      return;
    }

    this.ctx.events.emit(
      CameraCollisionEvent.type,
      {
        cameraId:
          activeCameraId,

        isColliding,

        targetLength:
          active.springArm
            .targetArmLength,

        actualLength:
          active.springArm
            .armLength,
      },
    );

    this.lastCollisionCameraId =
      activeCameraId;

    this.lastCollisionState =
      isColliding;
  }

  private sanitizeDelta(
    deltaSeconds:
      number,
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

    return Math.min(
      deltaSeconds,
      0.25,
    );
  }

  private sanitizeNonNegative(
    value:
      number,
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
