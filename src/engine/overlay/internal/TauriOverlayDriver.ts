import { invoke as tauriInvoke } from "@tauri-apps/api/core";

import type {
  OverlayWindowState,
  TaskbarBounds,
  TaskbarDockPosition,
} from "../../../contracts/overlay/types";

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

const DOCK_POSITIONS: ReadonlySet<string> = new Set(["top", "bottom", "left", "right"]);

export function isTauriRuntime(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    typeof (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ === "object"
  );
}

/** Erro nativo do overlay, com mensagem serializável. */
export class OverlayNativeError extends Error {
  public readonly unsupported: boolean;
  public constructor(message: string) {
    super(message);
    this.name = "OverlayNativeError";
    this.unsupported = message.startsWith("unsupported:");
  }
}

export interface CursorSample {
  readonly x: number;
  readonly y: number;
  readonly inside: boolean;
}

/**
 * Ponte com `overlay.rs` (G121): erros nativos são PROPAGADOS
 * (`OverlayNativeError`), nunca engolidos. Sem Tauri, `native` é false e
 * as operações de janela são simuladas pelo serviço (não há janela).
 */
export class TauriOverlayDriver {
  public constructor(
    private readonly invoke: Invoke = tauriInvoke as Invoke,
    private readonly hasNative: () => boolean = isTauriRuntime,
  ) {}

  public get native(): boolean {
    return this.hasNative();
  }

  public async setIgnoreCursorEvents(ignore: boolean): Promise<void> {
    await this.run("overlay_set_ignore_cursor_events", { ignore });
  }

  public async setAlwaysOnTop(alwaysOnTop: boolean): Promise<void> {
    await this.run("overlay_set_always_on_top", { alwaysOnTop });
  }

  public async setDecorations(decorations: boolean): Promise<void> {
    await this.run("overlay_set_decorations", { decorations });
  }

  public async getWindowState(): Promise<Omit<OverlayWindowState, "native">> {
    const raw = await this.run<Record<string, unknown>>("overlay_get_window_state");
    return {
      alwaysOnTop: raw?.alwaysOnTop === true,
      decorations: raw?.decorations !== false,
      ignoreCursorEvents: raw?.ignoreCursorEvents === true,
      taskbarSupported: raw?.taskbarSupported === true,
      platform: typeof raw?.platform === "string" ? raw.platform : "unknown",
    };
  }

  public async getCursorPosition(): Promise<CursorSample> {
    const raw = await this.run<Record<string, unknown>>("overlay_get_cursor_position");
    const x = Number(raw?.x);
    const y = Number(raw?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new OverlayNativeError("posição do cursor inválida");
    }
    return { x, y, inside: raw?.inside === true };
  }

  public async dockToTaskbar(position?: TaskbarDockPosition): Promise<TaskbarBounds> {
    if (position !== undefined && !DOCK_POSITIONS.has(position)) {
      throw new OverlayNativeError(`Posição de dock inválida: ${String(position)}`);
    }
    return validateBounds(
      await this.guard(() =>
        this.invoke<TaskbarBounds>("overlay_dock_to_taskbar", { position: position ?? null }),
      "overlay_dock_to_taskbar"),
    );
  }

  public async getTaskbarBounds(): Promise<TaskbarBounds> {
    return validateBounds(await this.run<TaskbarBounds>("overlay_get_taskbar_bounds"));
  }

  private run<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    return this.guard(() => this.invoke<T>(cmd, args), cmd);
  }

  /** Sem Tauri → "unsupported"; erro nativo → `OverlayNativeError`. */
  private async guard<T>(fn: () => Promise<T>, label = "overlay"): Promise<T> {
    if (!this.hasNative()) {
      throw new OverlayNativeError(`unsupported: sem host Tauri (${label})`);
    }
    try {
      return await fn();
    } catch (err) {
      throw new OverlayNativeError(
        typeof err === "string" ? err : err instanceof Error ? err.message : String(err),
      );
    }
  }
}

function validateBounds(raw: TaskbarBounds): TaskbarBounds {
  if (
    raw === null ||
    typeof raw !== "object" ||
    ![raw.x, raw.y, raw.width, raw.height].every(Number.isFinite) ||
    !DOCK_POSITIONS.has(raw.position)
  ) {
    throw new OverlayNativeError("limites da barra de tarefas inválidos");
  }
  return { x: raw.x, y: raw.y, width: raw.width, height: raw.height, position: raw.position };
}
