import type {
  OverlayMode,
  TaskbarBounds,
  TaskbarDockPosition,
} from "../../../contracts/overlay/types";

export class OverlayWindowManager {
  private mode: OverlayMode = "always_on_top_hud";
  private alwaysOnTopState = true;
  private taskbarBoundsCache: TaskbarBounds | null = null;

  public setMode(newMode: OverlayMode): void {
    this.mode = newMode;
  }

  public get currentMode(): OverlayMode {
    return this.mode;
  }

  public setAlwaysOnTop(alwaysOnTop: boolean): void {
    this.alwaysOnTopState = alwaysOnTop;
  }

  public get isAlwaysOnTop(): boolean {
    return this.alwaysOnTopState;
  }

  public updateTaskbarBounds(bounds: TaskbarBounds): void {
    this.taskbarBoundsCache = { ...bounds };
  }

  public get taskbarBounds(): TaskbarBounds | null {
    return this.taskbarBoundsCache;
  }

  public calculateDockPosition(
    windowWidth: number,
    windowHeight: number,
    preferredPosition?: TaskbarDockPosition
  ): { x: number; y: number } {
    if (!this.taskbarBoundsCache) {
      return { x: 0, y: 0 };
    }

    const tb = this.taskbarBoundsCache;
    const pos = preferredPosition || tb.position;

    const screenWidth =
      typeof window !== "undefined" && window.screen ? window.screen.width : 1920;
    const screenHeight =
      typeof window !== "undefined" && window.screen ? window.screen.height : 1080;

    switch (pos) {
      case "bottom":
        return { x: (screenWidth - windowWidth) / 2, y: tb.y - windowHeight };
      case "top":
        return { x: (screenWidth - windowWidth) / 2, y: tb.height };
      case "left":
        return { x: tb.width, y: (screenHeight - windowHeight) / 2 };
      case "right":
        return { x: tb.x - windowWidth, y: (screenHeight - windowHeight) / 2 };
      default:
        return { x: 0, y: 0 };
    }
  }

  public clear(): void {
    this.mode = "always_on_top_hud";
    this.alwaysOnTopState = true;
    this.taskbarBoundsCache = null;
  }
}