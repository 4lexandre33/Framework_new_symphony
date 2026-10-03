import type { Plugin, PluginContext } from "../../core/contracts/plugin-context";
import { RenderToken } from "../../tokens/render";
import {
  RenderFrameEvent,
  ViewportResizeEvent,
  SetCameraModeCommand,
} from "../../contracts/render/types";
import { ThreeRenderEngine } from "../../engine/render/ThreeRenderEngine";

export const renderManifest: Plugin["manifest"] = {
  id: "game.render",
  name: "WebGL 3D Three.js Render Plugin",
  version: "1.0.0",
  kind: "preloaded",
  authority: "game",
  permissions: {
    capabilities: [RenderToken.id],
    events: ["game.render.frame", "game.render.resize", "game.loop.render"],
  },
  capabilities: {
    provides: [
      {
        id: RenderToken.id,
        version: "1.0.0",
      },
    ],
  },
};

export function createRenderPlugin(): Plugin {
  return {
    manifest: renderManifest,

    setup(ctx: PluginContext) {
      const renderEngine = new ThreeRenderEngine();

      ctx.caps.provide(RenderToken, renderEngine);

      ctx.events.define(RenderFrameEvent);
      ctx.events.define(ViewportResizeEvent);
      ctx.commands.define(SetCameraModeCommand);

      const unbindRenderLoop = ctx.events.on(
        "game.loop.render",
        (event) => {
          const payload = event.payload as { alphaInterpolation: number; deltaSeconds: number };
          renderEngine.render(payload.alphaInterpolation, payload.deltaSeconds);
        }
      );

      const unbindCameraCommand = ctx.commands.handle(
        "game.render.set-camera-mode",
        (envelope) => {
          const payload = envelope.payload as { mode: any; target?: any };
          renderEngine.setCameraMode(payload.mode, payload.target);
        }
      );

      ctx.lifecycle.onDispose(() => {
        unbindRenderLoop();
        unbindCameraCommand();
        renderEngine.dispose();
      });

      ctx.lifecycle.ready();
    },
  };
}