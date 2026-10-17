import { defineEvent, defineCommand } from "@core";

/**
 * Modos de janela (G121). `setOverlayMode` APLICA as flags nativas:
 *
 * | modo                | sempre-no-topo | bordas | passthrough |
 * |---------------------|----------------|--------|-------------|
 * | `window` (padrão)   | não            | sim    | manual/off  |
 * | `always_on_top_hud` | sim            | não    | auto        |
 * | `desktop_pet`       | sim            | não    | auto        |
 * | `taskbar_dock`      | sim            | não    | auto + dock |
 *
 * Transparência NÃO muda em runtime: é opt-in do projeto em build time
 * (`src/projects/<id>/desktop.json`, ver scripts/tauri-project-config.mjs).
 */
export type OverlayMode = "window" | "desktop_pet" | "taskbar_dock" | "always_on_top_hud";

/**
 * G15: `manual` (padrão) = o passthrough só muda por `setPassthrough`, e
 * fica. `auto` = a engine rastreia o cursor real (DOM; nativo enquanto a
 * janela ignora o mouse) e liga o passthrough onde não há UI/mesh
 * interativo sob o cursor.
 */
export type PassthroughPolicy = "manual" | "auto";

/** Raycast 3D: true se há objeto interativo no pixel (px CSS da janela). */
export type OverlayRaycastProvider = (cursorX: number, cursorY: number) => {
  readonly hit: boolean;
  readonly entityId?: string;
};

/** Estado REAL da janela (lido do nativo; `native: false` = simulado no navegador). */
export interface OverlayWindowState {
  readonly native: boolean;
  readonly alwaysOnTop: boolean;
  readonly decorations: boolean;
  readonly ignoreCursorEvents: boolean;
  readonly taskbarSupported: boolean;
  readonly platform: string;
}

export interface OverlayModeResult {
  readonly mode: OverlayMode;
  /** true se TODAS as flags do modo foram aplicadas. */
  readonly applied: boolean;
  readonly state: OverlayWindowState;
  readonly passthroughPolicy: PassthroughPolicy;
  /** Só em `taskbar_dock`: true se a janela foi encaixada. */
  readonly docked?: boolean;
  /** Erros nativos (ou "unsupported: …") encontrados ao aplicar. */
  readonly errors: readonly string[];
}

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