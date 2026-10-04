import { defineEvent, defineCommand } from "@core";

export type OverlayMode = "desktop_pet" | "taskbar_dock" | "always_on_top_hud";

export type TaskbarDockPosition = "top" | "bottom" | "left" | "right";

export interface TaskbarBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly position: TaskbarDockPosition;
}

export interface HitTestResult {
  readonly hit: boolean;
  readonly targetType: "three_mesh" | "dom_ui" | "none";
  readonly entityId?: string;
  readonly elementId?: string;
}

// ── EVENTOS DE OVERLAY ───────────────────────────────────────────────────────

export interface PassthroughChangedPayload {
  readonly isIgnoringCursorEvents: boolean;
  readonly mode: OverlayMode;
}

export const PassthroughChangedEvent = defineEvent<
  "game.overlay.passthrough-changed",
  PassthroughChangedPayload
>("game.overlay.passthrough-changed");

export interface TaskbarResizedPayload {
  readonly bounds: TaskbarBounds;
}

export const TaskbarResizedEvent = defineEvent<
  "game.overlay.taskbar-resized",
  TaskbarResizedPayload
>("game.overlay.taskbar-resized");

// ── COMANDOS DE OVERLAY ──────────────────────────────────────────────────────

export interface SetPassthroughPayload {
  readonly ignoreCursorEvents: boolean;
}

export const SetPassthroughCommand = defineCommand<
  "game.overlay.set-passthrough",
  SetPassthroughPayload
>("game.overlay.set-passthrough");

export interface DockToTaskbarPayload {
  readonly position?: TaskbarDockPosition;
}

export const DockToTaskbarCommand = defineCommand<
  "game.overlay.dock-to-taskbar",
  DockToTaskbarPayload
>("game.overlay.dock-to-taskbar");

export interface SetAlwaysOnTopPayload {
  readonly alwaysOnTop: boolean;
}

export const SetAlwaysOnTopCommand = defineCommand<
  "game.overlay.set-always-on-top",
  SetAlwaysOnTopPayload
>("game.overlay.set-always-on-top");