import type { PluginContext } from "@core";
import { type OverlayApi } from "../../../tokens/overlay";
import { PassthroughChangedEvent, TaskbarResizedEvent, type HitTestResult, type OverlayMode, type TaskbarBounds, type TaskbarDockPosition } from "../../../contracts/overlay/types";
import { RaycastHitTestPassthrough } from "./RaycastHitTestPassthrough";
import { OverlayWindowManager } from "./OverlayWindowManager";
import { TauriOverlayDriver } from "./TauriOverlayDriver";

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
