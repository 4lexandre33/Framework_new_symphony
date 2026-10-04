import { defineCapability } from "@core";
import type {
  OverlayMode,
  TaskbarBounds,
  TaskbarDockPosition,
  HitTestResult,
} from "../contracts/overlay/types";

export interface OverlayApi {
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

export const OverlayToken = defineCapability<OverlayApi>("game.overlay", "1.0.0");