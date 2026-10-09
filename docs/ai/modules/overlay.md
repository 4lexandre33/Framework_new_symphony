# overlay — Desktop Overlay & Raycast Click Passthrough
capability: game.overlay@1.0.0 | category: functional | engine plugin id: game.overlay
dependsOn: game.loop
use (from src/projects/<jogo>/**):
  import { OverlayToken } from "../../tokens/overlay";
  // acesso: const api = ctx.caps.require(Token)  (declare o token em capabilities.consumes + permissions.capabilities)

## token src/tokens/overlay.ts
```ts
interface OverlayApi {
  readonly currentMode: OverlayMode;
  readonly isPassthroughActive: boolean;
  readonly isAlwaysOnTop: boolean;
  setPassthrough(enabled: boolean): Promise<void>;
  setAlwaysOnTop(alwaysOnTop: boolean): Promise<void>;
  setOverlayMode(mode: OverlayMode): void;
  dockToTaskbar(position?: TaskbarDockPosition): Promise<boolean>;
  getTaskbarBounds(): Promise<TaskbarBounds | null>;
  performHitTest(cursorX: number, cursorY: number): HitTestResult;
  update(cursorX: number, cursorY: number, deltaSeconds: number): void;
  clear(): void;
}
capability OverlayToken = "game.overlay"@1.0.0 api OverlayApi
```
## contract src/contracts/overlay/types.ts
```ts
export type OverlayMode = "desktop_pet" | "taskbar_dock" | "always_on_top_hud";
export type TaskbarDockPosition = "top" | "bottom" | "left" | "right";
interface TaskbarBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly position: TaskbarDockPosition;
}
interface HitTestResult {
  readonly hit: boolean;
  readonly targetType: "three_mesh" | "dom_ui" | "none";
  readonly entityId?: string;
  readonly elementId?: string;
}
interface PassthroughChangedPayload {
  readonly isIgnoringCursorEvents: boolean;
  readonly mode: OverlayMode;
}
event PassthroughChangedEvent = "game.overlay.passthrough-changed" payload PassthroughChangedPayload
interface TaskbarResizedPayload {
  readonly bounds: TaskbarBounds;
}
event TaskbarResizedEvent = "game.overlay.taskbar-resized" payload TaskbarResizedPayload
interface SetPassthroughPayload {
  readonly ignoreCursorEvents: boolean;
}
command SetPassthroughCommand = "game.overlay.set-passthrough" request SetPassthroughPayload
interface DockToTaskbarPayload {
  readonly position?: TaskbarDockPosition;
}
command DockToTaskbarCommand = "game.overlay.dock-to-taskbar" request DockToTaskbarPayload
interface SetAlwaysOnTopPayload {
  readonly alwaysOnTop: boolean;
}
command SetAlwaysOnTopCommand = "game.overlay.set-always-on-top" request SetAlwaysOnTopPayload
```
