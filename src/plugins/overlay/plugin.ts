import type {
  Plugin,
  PluginContext,
} from "../../core/contracts/plugin-context";

import {
  OverlayToken,
  type OverlayApi,
} from "../../tokens/overlay";

import type {
  GameTickPayload,
} from "../../contracts/game-loop/types";

import {
  DockToTaskbarCommand,
  PassthroughChangedEvent,
  SetAlwaysOnTopCommand,
  SetPassthroughCommand,
  TaskbarResizedEvent,
  type DockToTaskbarPayload,
  type HitTestResult,
  type OverlayMode,
  type SetAlwaysOnTopPayload,
  type SetPassthroughPayload,
  type TaskbarBounds,
  type TaskbarDockPosition,
} from "../../contracts/overlay/types";

import {
  RaycastHitTestPassthrough,
} from "../../engine/overlay/RaycastHitTestPassthrough";

import {
  OverlayWindowManager,
} from "../../engine/overlay/OverlayWindowManager";

import {
  TauriOverlayDriver,
} from "../../engine/overlay/TauriOverlayDriver";

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
  },
};

export class OverlayService implements OverlayApi {
  private readonly hitTest = new RaycastHitTestPassthrough();
  private readonly windowManager = new OverlayWindowManager();
  private readonly driver = new TauriOverlayDriver();
  private passthroughState = false;

  public constructor(private readonly ctx: PluginContext) {}

  public get currentMode(): OverlayMode {
    return this.windowManager.currentMode;
  }

  public get isPassthroughActive(): boolean {
    return this.passthroughState;
  }

  public get isAlwaysOnTop(): boolean {
    return this.windowManager.isAlwaysOnTop;
  }

  public async setPassthrough(enabled: boolean): Promise<void> {
    if (this.passthroughState === enabled) {
      return;
    }

    this.passthroughState = enabled;
    await this.driver.setIgnoreCursorEvents(enabled);

    this.ctx.events.emit(PassthroughChangedEvent.type, {
      isIgnoringCursorEvents: enabled,
      mode: this.currentMode,
    });
  }

  public async setAlwaysOnTop(alwaysOnTop: boolean): Promise<void> {
    this.windowManager.setAlwaysOnTop(alwaysOnTop);
    await this.driver.setAlwaysOnTop(alwaysOnTop);
  }

  public setOverlayMode(mode: OverlayMode): void {
    this.windowManager.setMode(mode);
  }

  public async dockToTaskbar(
    position?: TaskbarDockPosition,
  ): Promise<boolean> {
    const bounds = await this.driver.dockToTaskbar(position);

    if (!bounds) {
      return false;
    }

    this.windowManager.updateTaskbarBounds(bounds);
    this.windowManager.setMode("taskbar_dock");

    this.ctx.events.emit(TaskbarResizedEvent.type, {
      bounds,
    });

    return true;
  }

  public async getTaskbarBounds(): Promise<TaskbarBounds | null> {
    return this.driver.getTaskbarBounds();
  }

  public performHitTest(cursorX: number, cursorY: number): HitTestResult {
    return this.hitTest.performHitTest(cursorX, cursorY);
  }

  public update(
    cursorX: number,
    cursorY: number,
    _deltaSeconds: number,
  ): void {
    const hitResult = this.performHitTest(cursorX, cursorY);
    const shouldIgnoreCursor = !hitResult.hit;

    void this.setPassthrough(shouldIgnoreCursor);
  }

  public clear(): void {
    this.windowManager.clear();
    this.driver.reset();
    this.passthroughState = false;
  }
}

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
