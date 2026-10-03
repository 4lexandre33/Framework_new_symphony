import { invoke } from "@tauri-apps/api/core";

import type {
  TaskbarBounds,
  TaskbarDockPosition,
} from "../../contracts/overlay/types";

const FALLBACK_TASKBAR_HEIGHT = 40;
const FALLBACK_SCREEN_WIDTH = 1920;
const FALLBACK_SCREEN_HEIGHT = 1080;

export class TauriOverlayDriver {
  private lastIgnoreState: boolean | null = null;

  public async setIgnoreCursorEvents(ignore: boolean): Promise<void> {
    if (this.lastIgnoreState === ignore) {
      return;
    }

    try {
      await invoke("overlay_set_ignore_cursor_events", {
        ignore,
      });
    } catch {
      // Ambiente web/dev sem bridge Tauri: mantém apenas o estado local.
    }

    this.lastIgnoreState = ignore;
  }

  public async setAlwaysOnTop(alwaysOnTop: boolean): Promise<void> {
    try {
      await invoke("overlay_set_always_on_top", {
        alwaysOnTop,
      });
    } catch {
      // Ambiente web/dev sem bridge Tauri.
    }
  }

  public async dockToTaskbar(
    position?: TaskbarDockPosition,
  ): Promise<TaskbarBounds | null> {
    try {
      return await invoke<TaskbarBounds>("overlay_dock_to_taskbar", {
        position: position ?? null,
      });
    } catch {
      return this.getBrowserFallbackTaskbarBounds();
    }
  }

  public async getTaskbarBounds(): Promise<TaskbarBounds | null> {
    try {
      return await invoke<TaskbarBounds>("overlay_get_taskbar_bounds");
    } catch {
      return this.getBrowserFallbackTaskbarBounds();
    }
  }

  public reset(): void {
    this.lastIgnoreState = null;
  }

  private getBrowserFallbackTaskbarBounds(): TaskbarBounds {
    const screenWidth =
      typeof window !== "undefined" && window.screen
        ? window.screen.width
        : FALLBACK_SCREEN_WIDTH;

    const screenHeight =
      typeof window !== "undefined" && window.screen
        ? window.screen.height
        : FALLBACK_SCREEN_HEIGHT;

    return {
      x: 0,
      y: Math.max(0, screenHeight - FALLBACK_TASKBAR_HEIGHT),
      width: screenWidth,
      height: FALLBACK_TASKBAR_HEIGHT,
      position: "bottom",
    };
  }
}
