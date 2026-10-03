import * as THREE from "three";

import type {
  Plugin,
  PluginContext,
} from "../../core/contracts/plugin-context";

import {
  CameraToken,
  type CameraApi,
} from "../../tokens/camera";

import {
  PhysicsToken,
  type PhysicsApi,
} from "../../tokens/physics";

import {
  RenderToken,
  type Render3DApi,
} from "../../tokens/render";

import type {
  GameRenderPayload,
} from "../../contracts/game-loop/types";

import {
  CameraStateChangedEvent,
  CameraShakeTriggeredEvent,
  CameraCollisionEvent,
  AddCameraTraumaCommand,
  SetActiveVirtualCameraCommand,
  SetCameraFollowTargetCommand,
  type AddCameraTraumaRequest,
  type CameraTransformSnapshot,
  type SetActiveVirtualCameraRequest,
  type SetCameraFollowTargetRequest,
  type SpringArmConfig,
  type Vector3Camera,
  type VirtualCameraDescriptor,
} from "../../contracts/camera/types";

import {
  VirtualCameraStack,
} from "../../engine/camera/VirtualCameraStack";

export const cameraManifest:
  Plugin["manifest"] = {
    id:
      "game.camera",

    name:
      "Dynamic Camera, SpringArm3D & Trauma Shake Plugin",

    version:
      "1.0.0",

    kind:
      "preloaded",

    authority:
      "game",

    dependsOn: [
      {
        id:
          "game.loop",

        range:
          "^1.0.0",
      },

      {
        id:
          "game.physics",

        range:
          "^1.0.0",
      },

      {
        id:
          "game.render",

        range:
          "^1.0.0",
      },
    ],

    permissions: {
      capabilities: [
        CameraToken.id,
        PhysicsToken.id,
        RenderToken.id,
      ],

      events: [
        "game.camera.state-changed",
        "game.camera.shake-triggered",
        "game.camera.collision-changed",
        "game.loop.render",
      ],
    },

    capabilities: {
      provides: [
        {
          id:
            CameraToken.id,

          version:
            "1.0.0",
        },
      ],

      consumes: [
        {
          id:
            PhysicsToken.id,

          range:
            "^1.0.0",
        },

        {
          id:
            RenderToken.id,

          range:
            "^1.0.0",
        },
      ],
    },
  };

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
    this.physics =
      physics;

    this.renderApi =
      renderApi;
  }

  public registerVirtualCamera(
    descriptor:
      VirtualCameraDescriptor,
  ): void {
    this.stack.registerCamera(
      descriptor,
    );
  }

  public unregisterVirtualCamera(
    cameraId: string,
  ): boolean {
    const removed =
      this.stack.unregisterCamera(
        cameraId,
      );

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
    cameraId: string,
    blendDurationSeconds =
      0.5,
  ): boolean {
    const previousCameraId =
      this.stack
        .getActiveCameraId();

    const safeBlendDuration =
      this.sanitizeNonNegative(
        blendDurationSeconds,
      );

    const changed =
      previousCameraId !==
      cameraId;

    const activated =
      this.stack.setActiveCamera(
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
    traumaAmount: number,
  ): void {
    if (
      !Number.isFinite(
        traumaAmount,
      )
    ) {
      return;
    }

    const active =
      this.stack
        .getActiveCameraState();

    if (!active) {
      return;
    }

    active.shake.addTrauma(
      traumaAmount,
    );

    this.ctx.events.emit(
      CameraShakeTriggeredEvent.type,
      {
        traumaAmount,

        currentTotalTrauma:
          active.shake
            .currentTrauma,
      },
    );
  }

  public setFollowTarget(
    cameraId: string,
    targetPosition:
      Vector3Camera,
  ): void {
    this.stack.setFollowTarget(
      cameraId,
      targetPosition,
    );
  }

  public configureSpringArm(
    cameraId: string,
    config:
      Partial<SpringArmConfig>,
  ): void {
    const camera =
      this.stack.getCameraState(
        cameraId,
      );

    if (
      !camera ||
      !camera.springArm
    ) {
      return;
    }

    camera.springArm
      .updateConfig(
        config,
      );
  }

  public getActiveCameraId():
    string | null {
    return this.stack
      .getActiveCameraId();
  }

  public getCurrentCameraSnapshot():
    CameraTransformSnapshot | null {
    const active =
      this.stack
        .getActiveCameraState();

    if (!active) {
      return null;
    }

    return {
      position:
        active.descriptor
          .position,

      rotation:
        active.descriptor
          .rotation,

      fov:
        active.descriptor
          .fov,

      isColliding:
        active.springArm
          ?.isCurrentlyColliding ??
        false,

      currentArmLength:
        active.springArm
          ?.armLength ??
        0,

      currentTrauma:
        active.shake
          .currentTrauma,
    };
  }

  public render(
    deltaSeconds: number,
  ): void {
    const safeDelta =
      this.sanitizeDelta(
        deltaSeconds,
      );

    const renderApi =
      this.renderApi;

    if (!renderApi) {
      return;
    }

    const cameraTransform =
      this.stack.update(
        safeDelta,
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
      THREE.PerspectiveCamera
    ) {
      if (
        activeThreeCamera.fov !==
        cameraTransform.fov
      ) {
        activeThreeCamera.fov =
          cameraTransform.fov;

        activeThreeCamera
          .updateProjectionMatrix();
      }
    }

    this.emitCollisionChangeIfNeeded();
  }

  public dispose(): void {
    this.stack.clear();

    this.lastCollisionCameraId =
      null;

    this.lastCollisionState =
      false;
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
      !activeCameraId ||
      !active ||
      !active.springArm
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
      cameraChanged ||
      collisionChanged
    ) {
      const targetLength =
        active.descriptor
          .springArmConfig
          ?.targetArmLength ??
        active.springArm
          .armLength;

      this.ctx.events.emit(
        CameraCollisionEvent.type,
        {
          cameraId:
            activeCameraId,

          isColliding,

          targetLength,

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

export function createCameraPlugin():
  Plugin {
  let cameraService:
    CameraService | null =
      null;

  const manifest:
    Plugin["manifest"] = {
      ...cameraManifest,

      lifecycleHooks: {
        ...cameraManifest.lifecycleHooks,

        onBoot(
          ctx:
            PluginContext,
        ): void {
          if (!cameraService) {
            throw new Error(
              "CameraService não foi criado durante setup().",
            );
          }

          const physics =
            ctx.caps.require(
              PhysicsToken,
            );

          const render =
            ctx.caps.require(
              RenderToken,
            );

          cameraService
            .bindDependencies(
              physics,
              render,
            );
        },
      },
    };

  return {
    manifest,

    setup(
      ctx:
        PluginContext,
    ): void {
      const service =
        new CameraService(
          ctx,
        );

      cameraService =
        service;

      ctx.caps.provide(
        CameraToken,
        service,
      );

      ctx.events.define(
        CameraStateChangedEvent,
      );

      ctx.events.define(
        CameraShakeTriggeredEvent,
      );

      ctx.events.define(
        CameraCollisionEvent,
      );

      ctx.commands.define(
        AddCameraTraumaCommand,
      );

      ctx.commands.define(
        SetActiveVirtualCameraCommand,
      );

      ctx.commands.define(
        SetCameraFollowTargetCommand,
      );

      const unbindRender =
        ctx.events.on(
          "game.loop.render",
          (
            envelope,
          ): void => {
            const payload =
              envelope.payload as
                GameRenderPayload;

            service.render(
              payload.deltaSeconds,
            );
          },
        );

      const unbindAddTrauma =
        ctx.commands.handle(
          AddCameraTraumaCommand.type,
          (
            envelope,
          ): void => {
            const payload =
              envelope.payload as
                AddCameraTraumaRequest;

            service.addTrauma(
              payload.traumaAmount,
            );
          },
        );

      const unbindSetActive =
        ctx.commands.handle(
          SetActiveVirtualCameraCommand.type,
          (
            envelope,
          ): boolean => {
            const payload =
              envelope.payload as
                SetActiveVirtualCameraRequest;

            return service
              .setActiveCamera(
                payload.cameraId,
                payload
                  .blendDurationSeconds,
              );
          },
        );

      const unbindSetTarget =
        ctx.commands.handle(
          SetCameraFollowTargetCommand.type,
          (
            envelope,
          ): void => {
            const payload =
              envelope.payload as
                SetCameraFollowTargetRequest;

            service.setFollowTarget(
              payload.cameraId,
              payload.targetPosition,
            );
          },
        );

      ctx.lifecycle.onDispose(
        (): void => {
          unbindRender();
          unbindAddTrauma();
          unbindSetActive();
          unbindSetTarget();

          service.dispose();

          if (
            cameraService ===
            service
          ) {
            cameraService =
              null;
          }
        },
      );

      ctx.lifecycle.ready();
    },
  };
}
