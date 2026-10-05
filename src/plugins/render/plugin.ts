import type {
  Plugin,
  PluginContext,
} from "@core";

import type {
  RenderFramePayload,
  SetCameraModeRequest,
  ViewportResizePayload,
} from "../../contracts/render/types";

import {
  RenderFrameEvent,
  SetCameraModeCommand,
  ViewportResizeEvent,
} from "../../contracts/render/types";

import { ThreeRenderEngine } from "../../engine/render/internal/ThreeRenderEngine";
import { RenderToken } from "../../tokens/render";

export const renderManifest: Plugin["manifest"] = {
  id: "game.render",
  name: "WebGL 3D Three.js Render Plugin",
  version: "1.0.0",
  kind: "preloaded",
  authority: "game",
  permissions: {
    capabilities: [
      RenderToken.id,
    ],
    events: [
      "game.render.frame",
      "game.render.resize",
      "game.loop.render",
    ],
  },
  capabilities: {
    provides: [
      {
        id:
          RenderToken.id,
        version:
          "1.0.0",
      },
    ],
    conflicts: [],
  },
};

export type RenderEngineFactory =
  () => ThreeRenderEngine;

export function createRenderPlugin(
  engineFactory:
    RenderEngineFactory =
      (): ThreeRenderEngine =>
        new ThreeRenderEngine(),
): Plugin {
  return {
    manifest:
      renderManifest,

    setup(
      ctx: PluginContext,
    ): void {
      const renderEngine =
        engineFactory();

      ctx.caps.provide(
        RenderToken,
        renderEngine,
      );

      ctx.events.define(
        RenderFrameEvent,
      );

      ctx.events.define(
        ViewportResizeEvent,
      );

      ctx.commands.define(
        SetCameraModeCommand,
      );

      const unbindRenderLoop =
        ctx.events.on<
          "game.loop.render",
          RenderFramePayload
        >(
          "game.loop.render",
          async (
            event,
          ): Promise<void> => {
            const payload =
              event.payload;

            renderEngine.render(
              payload.alphaInterpolation,
              payload.deltaSeconds,
            );

            await ctx.events.emitAsync(
              RenderFrameEvent.type,
              payload,
            );
          },
        );

      const unbindViewportResize =
        renderEngine.onViewportResize(
          (
            dimensions,
          ): void => {
            const payload:
              ViewportResizePayload = {
                width:
                  dimensions.width,
                height:
                  dimensions.height,
                aspectRatio:
                  dimensions.aspectRatio,
                pixelRatio:
                  dimensions.pixelRatio,
              };

            // Resize é evento esporádico do host, não parte do hot path de frame.
            ctx.events.emit(
              ViewportResizeEvent.type,
              payload,
            );
          },
        );

      const unbindCameraCommand =
        ctx.commands.handle<
          "game.render.set-camera-mode",
          SetCameraModeRequest
        >(
          SetCameraModeCommand.type,
          (
            envelope,
          ): void => {
            renderEngine.setCameraMode(
              envelope.payload.mode,
              envelope.payload.target,
            );
          },
        );

      ctx.lifecycle.onDispose(
        (): void => {
          unbindRenderLoop();
          unbindViewportResize();
          unbindCameraCommand();
          renderEngine.dispose();
        },
      );

      ctx.lifecycle.ready();
    },
  };
}
