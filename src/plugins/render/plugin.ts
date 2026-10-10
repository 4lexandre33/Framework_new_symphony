import type {
  Plugin,
  PluginContext,
} from "@core";

import type {
  RenderContextPayload,
  RenderFramePayload,
  SetCameraModeRequest,
  ViewportResizePayload,
} from "../../contracts/render/types";

import {
  RenderContextLostEvent,
  RenderContextRestoredEvent,
  RenderFrameEvent,
  SetCameraModeCommand,
  ViewportResizeEvent,
} from "../../contracts/render/types";

import { ThreeRenderEngine } from "../../engine/render/internal/ThreeRenderEngine";
import {
  RenderToken,
  type Render3DApi,
} from "../../tokens/render";

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
      "game.render.context-lost",
      "game.render.context-restored",
      "game.loop.render",
      "game.loop.tick",
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

/**
 * Promise já resolvida usada como barreira de microtask no frame (G41):
 * `await` nela adia o desenho até depois da parte síncrona de TODOS os
 * handlers de `game.loop.render` (câmera, vfx, sprites, jogo), sem alocar
 * uma Promise nova por frame.
 */
const AFTER_SYNC_RENDER_HANDLERS: Promise<void> =
  Promise.resolve();

/**
 * Fachada entregue pelo token (G44): idêntica ao engine, exceto `dispose()`,
 * que pelo token vira no-op com aviso. Só o plugin descarta o engine real.
 */
function createRenderFacade(
  engine: ThreeRenderEngine,
  warn: (message: string) => void,
): Render3DApi {
  return {
    render: (alpha, delta) => engine.render(alpha, delta),
    resize: (width, height, pixelRatio) => engine.resize(width, height, pixelRatio),
    getCanvas: () => engine.getCanvas(),
    getRenderer: () => engine.getRenderer(),
    getActiveCamera: () => engine.getActiveCamera(),
    getScene: () => engine.getScene(),
    getViewportDimensions: () => engine.getViewportDimensions(),
    setCameraMode: (mode, target) => engine.setCameraMode(mode, target),
    updateCameraTarget: (target, offset) => engine.updateCameraTarget(target, offset),
    setAmbientLight: (config) => engine.setAmbientLight(config),
    setDirectionalLight: (config) => engine.setDirectionalLight(config),
    setShadowFocus: (center) => engine.setShadowFocus(center),
    addLight: (lightId, config) => engine.addLight(lightId, config),
    removeLight: (lightId) => engine.removeLight(lightId),
    addMeshToScene: (key, object) => engine.addMeshToScene(key, object),
    removeMeshFromScene: (key, options) => engine.removeMeshFromScene(key, options),
    getMeshFromScene: (key) => engine.getMeshFromScene(key),
    setInterpolated: (key, enabled) => engine.setInterpolated(key, enabled),
    snapInterpolation: (key) => engine.snapInterpolation(key),
    captureInterpolationState: () => engine.captureInterpolationState(),
    configurePerspectiveCamera: (options) => engine.configurePerspectiveCamera(options),
    configureOrthographicCamera: (options) => engine.configureOrthographicCamera(options),
    getCameraSettings: () => engine.getCameraSettings(),
    setViewportOptions: (options) => engine.setViewportOptions(options),
    setFrameRenderer: (frameRenderer) => engine.setFrameRenderer(frameRenderer),
    isContextLost: () => engine.isContextLost(),
    dispose: (): void => {
      warn(
        "RenderApi.dispose() pelo token é ignorado: o renderer é compartilhado e só o plugin game.render o descarta no shutdown.",
      );
    },
  };
}

export function createRenderPlugin(
  engineFactory:
    RenderEngineFactory =
      (): ThreeRenderEngine =>
        new ThreeRenderEngine(),
): Plugin {
  let bootResize:
    (() => void) | null = null;

  const manifest: Plugin["manifest"] = {
    ...renderManifest,
    lifecycleHooks: {
      ...renderManifest.lifecycleHooks,
      // G43: publica as dimensões iniciais depois que todos os plugins
      // registraram seus listeners.
      onBoot(): void {
        bootResize?.();
      },
    },
  };

  return {
    manifest,

    setup(
      ctx: PluginContext,
    ): void {
      const renderEngine =
        engineFactory();

      ctx.caps.provide(
        RenderToken,
        createRenderFacade(
          renderEngine,
          (message: string): void => {
            ctx.log.warn(message);
          },
        ),
      );

      ctx.events.define(
        RenderFrameEvent,
      );

      ctx.events.define(
        ViewportResizeEvent,
      );

      ctx.events.define(
        RenderContextLostEvent,
      );

      ctx.events.define(
        RenderContextRestoredEvent,
      );

      ctx.commands.define(
        SetCameraModeCommand,
      );

      // G40: o estado anterior dos objetos interpolados é capturado no
      // início de cada tick fixo (este handler é registrado antes dos
      // plugins que dependem de game.render).
      const unbindTick =
        ctx.events.on(
          "game.loop.tick",
          (): void => {
            renderEngine.captureInterpolationState();
          },
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

            // G41: desenha DEPOIS da parte síncrona dos demais handlers
            // deste frame (câmera/jogo), não antes.
            await AFTER_SYNC_RENDER_HANDLERS;

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

      const emitResize = (
        dimensions: Readonly<ViewportResizePayload>,
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
      };

      const unbindViewportResize =
        renderEngine.onViewportResize(
          emitResize,
        );

      bootResize = (): void => {
        emitResize(
          renderEngine.getViewportDimensions(),
        );
      };

      const unbindContext =
        renderEngine.onContextChange(
          (
            contextLost: boolean,
          ): void => {
            const payload:
              RenderContextPayload = {
                contextLost,
              };

            ctx.events.emit(
              contextLost
                ? RenderContextLostEvent.type
                : RenderContextRestoredEvent.type,
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
          bootResize = null;
          unbindTick();
          unbindRenderLoop();
          unbindViewportResize();
          unbindContext();
          unbindCameraCommand();
          renderEngine.dispose();
        },
      );

      ctx.lifecycle.ready();
    },
  };
}
