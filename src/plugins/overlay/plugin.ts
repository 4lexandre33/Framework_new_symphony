import type { Plugin, PluginContext } from "@core";
import { OverlayToken } from "../../tokens/overlay";
import { RenderToken } from "../../tokens/render";
import type { GameTickPayload } from "../../contracts/game-loop/types";
import { DockToTaskbarCommand, PassthroughChangedEvent, SetAlwaysOnTopCommand, SetPassthroughCommand, TaskbarResizedEvent, type DockToTaskbarPayload, type SetAlwaysOnTopPayload, type SetPassthroughPayload } from "../../contracts/overlay/types";
import { OverlayService } from "../../engine/overlay/internal/OverlayService";
import { createThreeRaycastProvider } from "../../engine/overlay/internal/ThreeRaycastProvider";

export const overlayManifest: Plugin["manifest"] = {
  id: "game.overlay",
  name: "Desktop Overlay, Taskbar Docking & Click Passthrough Plugin",
  version: "1.0.0",
  kind: "preloaded",
  authority: "game",
  dependsOn: [
    {
      id: "game.loop",
      range: "^1.0.0",
    },
    // Opcional (G15): raycast 3D do hit-test usa cena/câmera do render.
    {
      id: "game.render",
      range: "^1.0.0",
      optional: true,
    },
  ],
  permissions: {
    capabilities: [
      OverlayToken.id,
      RenderToken.id,
    ],
    events: [
      PassthroughChangedEvent.type,
      TaskbarResizedEvent.type,
      "game.loop.tick",
    ],
  },
  capabilities: {
    provides: [
      {
        id: OverlayToken.id,
        version: "1.0.0",
      },
    ],
    consumes: [
      { id: RenderToken.id, range: "^1.0.0", optional: true },
    ],
    conflicts: [],
  },
};

export function createOverlayPlugin(): Plugin {
  let overlayService: OverlayService | null = null;
  return {
    manifest: {
      ...overlayManifest,
      lifecycleHooks: {
        ...overlayManifest.lifecycleHooks,
        onBoot(ctx: PluginContext): void {
          // G15: liga o raycast 3D se houver render (opcional).
          const render = ctx.caps.get(RenderToken);
          if (render && overlayService) {
            overlayService.setRaycastProvider(createThreeRaycastProvider(render));
            try {
              overlayService.setSceneCanvas(render.getCanvas());
            } catch {
              /* render headless */
            }
          }
        },
      },
    },

    setup(ctx: PluginContext): void {
      overlayService = new OverlayService(ctx);
      const service = overlayService;

      ctx.caps.provide(OverlayToken, service);

      ctx.events.define(PassthroughChangedEvent);
      ctx.events.define(TaskbarResizedEvent);

      ctx.commands.define(SetPassthroughCommand);
      ctx.commands.define(DockToTaskbarCommand);
      ctx.commands.define(SetAlwaysOnTopCommand);

      // G15: lê o estado REAL da janela; padrão seguro = passthrough manual
      // e desligado (nada é alterado no boot).
      void service.initialize();

      // G15: nada de update(0,0) por tick. Em política "auto" o tick só
      // reavalia o cursor REAL (throttled); em "manual" não faz nada.
      const unbindTick = ctx.events.on(
        "game.loop.tick",
        (envelope): void => {
          const payload = envelope.payload as GameTickPayload;
          if (payload.deltaSeconds > 0) service.onTick();
        },
      );

      const unbindSetPassthrough = ctx.commands.handle(
        SetPassthroughCommand.type,
        (envelope): Promise<void> => {
          const payload = envelope.payload as SetPassthroughPayload;
          return service.setPassthrough(payload.ignoreCursorEvents);
        },
      );

      const unbindDock = ctx.commands.handle(
        DockToTaskbarCommand.type,
        (envelope): Promise<boolean> => {
          const payload = envelope.payload as DockToTaskbarPayload;
          return service.dockToTaskbar(payload.position);
        },
      );

      const unbindAlwaysOnTop = ctx.commands.handle(
        SetAlwaysOnTopCommand.type,
        (envelope): Promise<void> => {
          const payload = envelope.payload as SetAlwaysOnTopPayload;
          return service.setAlwaysOnTop(payload.alwaysOnTop);
        },
      );

      ctx.lifecycle.onDispose(async (): Promise<void> => {
        unbindTick();
        unbindSetPassthrough();
        unbindDock();
        unbindAlwaysOnTop();
        // G121: reverte o nativo ao estado lido no boot.
        await service.restoreWindow().catch(() => undefined);
        service.dispose();
      });

      ctx.lifecycle.ready();
    },
  };
}