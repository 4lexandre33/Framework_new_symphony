import type { Plugin, PluginContext } from "@core";
import { CameraToken } from "../../tokens/camera";
import { PhysicsToken } from "../../tokens/physics";
import { RenderToken } from "../../tokens/render";
import type { GameRenderPayload } from "../../contracts/game-loop/types";
import { CameraStateChangedEvent, CameraShakeTriggeredEvent, CameraCollisionEvent, CameraOcclusionChangedEvent, AddCameraTraumaCommand, SetActiveVirtualCameraCommand, SetCameraFollowTargetCommand, type AddCameraTraumaRequest, type SetActiveVirtualCameraRequest, type SetCameraFollowTargetRequest } from "../../contracts/camera/types";
import { CameraService } from "../../engine/camera/internal/CameraService";

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
        "game.camera.occlusion-changed",
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
          optional: false,
        },

        {
          id:
            RenderToken.id,

          range:
            "^1.0.0",
          optional: false,
        },
      ],
      conflicts: [],
    },
  };

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

      ctx.events.define(
        CameraOcclusionChangedEvent,
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