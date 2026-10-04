import type { Plugin, PluginContext } from "@core";
import { OverlayToken } from "../../tokens/overlay";
import type { GameTickPayload } from "../../contracts/game-loop/types";
import { DockToTaskbarCommand, PassthroughChangedEvent, SetAlwaysOnTopCommand, SetPassthroughCommand, TaskbarResizedEvent, type DockToTaskbarPayload, type SetAlwaysOnTopPayload, type SetPassthroughPayload } from "../../contracts/overlay/types";
import { OverlayService } from "../../engine/overlay/internal/OverlayService";

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
  ],
  permissions: {
    capabilities: [
      OverlayToken.id,
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
    conflicts: [],
  },
};

export function createOverlayPlugin(): Plugin {
  return {
    manifest: overlayManifest,

    setup(ctx: PluginContext): void {
      const overlayService = new OverlayService(ctx);

      ctx.caps.provide(OverlayToken, overlayService);

      ctx.events.define(PassthroughChangedEvent);
      ctx.events.define(TaskbarResizedEvent);

      ctx.commands.define(SetPassthroughCommand);
      ctx.commands.define(DockToTaskbarCommand);
      ctx.commands.define(SetAlwaysOnTopCommand);

      const unbindTick = ctx.events.on(
        "game.loop.tick",
        (envelope): void => {
          const payload = envelope.payload as GameTickPayload;
          overlayService.update(0, 0, payload.deltaSeconds);
        },
      );

      const unbindSetPassthrough = ctx.commands.handle(
        SetPassthroughCommand.type,
        (envelope): Promise<void> => {
          const payload = envelope.payload as SetPassthroughPayload;
          return overlayService.setPassthrough(payload.ignoreCursorEvents);
        },
      );

      const unbindDock = ctx.commands.handle(
        DockToTaskbarCommand.type,
        (envelope): Promise<boolean> => {
          const payload = envelope.payload as DockToTaskbarPayload;
          return overlayService.dockToTaskbar(payload.position);
        },
      );

      const unbindAlwaysOnTop = ctx.commands.handle(
        SetAlwaysOnTopCommand.type,
        (envelope): Promise<void> => {
          const payload = envelope.payload as SetAlwaysOnTopPayload;
          return overlayService.setAlwaysOnTop(payload.alwaysOnTop);
        },
      );

      ctx.lifecycle.onDispose((): void => {
        unbindTick();
        unbindSetPassthrough();
        unbindDock();
        unbindAlwaysOnTop();
        overlayService.clear();
      });

      ctx.lifecycle.ready();
    },
  };
}