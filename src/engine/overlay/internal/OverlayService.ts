import type { PluginContext } from "@core";
import { type OverlayApi } from "../../../tokens/overlay";
import {
  PassthroughChangedEvent,
  TaskbarResizedEvent,
  type HitTestResult,
  type OverlayMode,
  type OverlayModeResult,
  type OverlayRaycastProvider,
  type OverlayWindowState,
  type PassthroughPolicy,
  type TaskbarBounds,
  type TaskbarDockPosition,
} from "../../../contracts/overlay/types";
import { RaycastHitTestPassthrough } from "./RaycastHitTestPassthrough";
import { OverlayWindowManager } from "./OverlayWindowManager";
import { OverlayNativeError, TauriOverlayDriver } from "./TauriOverlayDriver";

export interface OverlayServiceOptions {
  readonly driver?: TauriOverlayDriver;
  /** Alvo dos eventos de ponteiro (default `window` quando existe). */
  readonly pointerTarget?: Pick<EventTarget, "addEventListener" | "removeEventListener"> | null;
  readonly now?: () => number;
  /** Intervalo mínimo entre reavaliações por tick / polls nativos (ms). */
  readonly evaluateIntervalMs?: number;
}

interface ModePreset {
  readonly alwaysOnTop: boolean;
  readonly decorations: boolean;
  readonly policy: PassthroughPolicy;
}

const MODE_PRESETS: Readonly<Record<OverlayMode, ModePreset>> = Object.freeze({
  window: { alwaysOnTop: false, decorations: true, policy: "manual" },
  always_on_top_hud: { alwaysOnTop: true, decorations: false, policy: "auto" },
  desktop_pet: { alwaysOnTop: true, decorations: false, policy: "auto" },
  taskbar_dock: { alwaysOnTop: true, decorations: false, policy: "auto" },
});

const DEFAULT_EVALUATE_INTERVAL_MS = 33;

/**
 * G15/G121.
 *
 * - Passthrough `manual` (padrão): só `setPassthrough` muda, e o valor FICA
 *   (nada por tick). `auto`: cursor REAL — `pointermove` do DOM enquanto a
 *   janela recebe mouse; poll nativo (`overlay_get_cursor_position`)
 *   enquanto ela ignora o mouse (o webview não recebe eventos então).
 * - Hit-test: DOM + raycast 3D (`setRaycastProvider`; o plugin liga o do
 *   `game.render`).
 * - Getters refletem o estado CONFIRMADO pelo nativo; erros nativos
 *   rejeitam os setters e ficam em `lastError`.
 * - `clear`/`restoreWindow` revertem o nativo ao estado lido no boot.
 */
export class OverlayService implements OverlayApi {
  private readonly hitTest = new RaycastHitTestPassthrough();
  private readonly windowManager = new OverlayWindowManager();
  private readonly driver: TauriOverlayDriver;
  private readonly pointerTarget: OverlayServiceOptions["pointerTarget"];
  private readonly now: () => number;
  private readonly evaluateIntervalMs: number;

  private passthroughState = false;
  private decorationsState = true;
  private policy: PassthroughPolicy = "manual";
  private errorState: string | null = null;
  private raycast: OverlayRaycastProvider | undefined;
  private taskbarSupported = false;
  private platform = "browser";

  private cursorX = 0;
  private cursorY = 0;
  private cursorKnown = false;
  private cursorInside = false;
  private lastEvaluateAt = Number.NEGATIVE_INFINITY;
  private pollInFlight = false;
  private passthroughInFlight: Promise<void> | null = null;
  private pointerAttached = false;
  private disposed = false;

  /** Estado nativo lido no boot (para `clear` reverter). */
  private initialState: { alwaysOnTop: boolean; decorations: boolean; ignore: boolean } | null = null;

  private readonly onPointerMove = (event: Event): void => {
    const e = event as PointerEvent;
    if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return;
    this.cursorX = e.clientX;
    this.cursorY = e.clientY;
    this.cursorKnown = true;
    this.cursorInside = true;
    this.evaluate();
  };

  /** `mouseout` com `relatedTarget` nulo = cursor saiu da janela; `blur` idem. */
  private readonly onPointerLeave = (event: Event): void => {
    if (event.type === "mouseout" && (event as MouseEvent).relatedTarget !== null) return;
    this.cursorInside = false;
    this.evaluate();
  };

  public constructor(
    private readonly ctx: PluginContext,
    options: OverlayServiceOptions = {},
  ) {
    this.driver = options.driver ?? new TauriOverlayDriver();
    this.pointerTarget =
      options.pointerTarget !== undefined
        ? options.pointerTarget
        : typeof window !== "undefined" && typeof window.addEventListener === "function"
          ? window
          : null;
    this.now = options.now ?? defaultNow;
    this.evaluateIntervalMs = Math.max(0, options.evaluateIntervalMs ?? DEFAULT_EVALUATE_INTERVAL_MS);
  }

  // ── getters ───────────────────────────────────────────────────────────

  public get currentMode(): OverlayMode {
    return this.windowManager.currentMode;
  }

  public get isPassthroughActive(): boolean {
    return this.passthroughState;
  }

  public get isAlwaysOnTop(): boolean {
    return this.windowManager.isAlwaysOnTop;
  }

  public get passthroughPolicy(): PassthroughPolicy {
    return this.policy;
  }

  public get lastError(): string | null {
    return this.errorState;
  }

  // ── boot ──────────────────────────────────────────────────────────────

  /** Lê o estado nativo inicial (getters passam a refletir a janela real). */
  public async initialize(): Promise<OverlayWindowState> {
    const state = await this.refreshWindowState();
    this.initialState = {
      alwaysOnTop: state.alwaysOnTop,
      decorations: state.decorations,
      ignore: state.ignoreCursorEvents,
    };
    return state;
  }

  public async refreshWindowState(): Promise<OverlayWindowState> {
    if (!this.driver.native) {
      return this.snapshotState(false);
    }
    try {
      const s = await this.driver.getWindowState();
      this.windowManager.setAlwaysOnTop(s.alwaysOnTop);
      this.decorationsState = s.decorations;
      this.passthroughState = s.ignoreCursorEvents;
      this.taskbarSupported = s.taskbarSupported;
      this.platform = s.platform;
      this.errorState = null;
    } catch (err) {
      this.errorState = messageOf(err);
    }
    return this.snapshotState(true);
  }

  // ── passthrough ───────────────────────────────────────────────────────

  public async setPassthrough(enabled: boolean): Promise<void> {
    await this.applyPassthrough(enabled, true);
  }

  public setPassthroughPolicy(policy: PassthroughPolicy): void {
    if (policy !== "manual" && policy !== "auto") {
      throw new TypeError(`política de passthrough inválida: ${String(policy)}`);
    }
    this.policy = policy;
    if (policy === "auto") {
      this.attachPointer();
      this.lastEvaluateAt = Number.NEGATIVE_INFINITY;
      this.evaluate();
    } else {
      this.detachPointer();
    }
  }

  public setRaycastProvider(provider: OverlayRaycastProvider | null): void {
    this.raycast = provider ?? undefined;
  }

  /** O plugin informa o canvas da cena (vai para o raycast, não é UI). */
  public setSceneCanvas(canvas: Element | null): void {
    this.hitTest.sceneCanvas = canvas;
  }

  public performHitTest(cursorX: number, cursorY: number): HitTestResult {
    return this.hitTest.performHitTest(cursorX, cursorY, this.raycast);
  }

  public update(cursorX: number, cursorY: number, _deltaSeconds: number): void {
    if (!Number.isFinite(cursorX) || !Number.isFinite(cursorY)) return;
    this.cursorX = cursorX;
    this.cursorY = cursorY;
    this.cursorKnown = true;
    this.cursorInside = true;
    this.lastEvaluateAt = Number.NEGATIVE_INFINITY;
    this.evaluate();
  }

  /**
   * Chamado pelo plugin a cada `game.loop.tick`. Em `manual` não faz nada.
   * Em `auto`: com a janela ignorando o mouse, faz poll do cursor nativo;
   * senão reavalia o último cursor (a cena 3D pode ter se movido). Ambos
   * com intervalo mínimo; sem alocação no caminho comum.
   */
  public onTick(): void {
    if (this.policy !== "auto" || this.disposed) return;
    const now = this.now();
    if (now - this.lastEvaluateAt < this.evaluateIntervalMs) return;
    if (this.passthroughState && this.driver.native) {
      this.pollNativeCursor(now);
      return;
    }
    if (this.cursorKnown) this.evaluate();
  }

  // ── janela ────────────────────────────────────────────────────────────

  public async setAlwaysOnTop(alwaysOnTop: boolean): Promise<void> {
    if (!this.driver.native) {
      this.windowManager.setAlwaysOnTop(alwaysOnTop);
      return;
    }
    try {
      await this.driver.setAlwaysOnTop(alwaysOnTop);
      this.windowManager.setAlwaysOnTop(alwaysOnTop);
      this.errorState = null;
    } catch (err) {
      this.errorState = messageOf(err);
      throw err;
    }
  }

  public async setOverlayMode(mode: OverlayMode): Promise<OverlayModeResult> {
    const preset = MODE_PRESETS[mode];
    if (preset === undefined) {
      throw new TypeError(`modo de overlay inválido: ${String(mode)}`);
    }
    const errors: string[] = [];
    const attempt = async (fn: () => Promise<void>): Promise<void> => {
      try {
        await fn();
      } catch (err) {
        errors.push(messageOf(err));
      }
    };

    await attempt(() => this.setAlwaysOnTop(preset.alwaysOnTop));
    await attempt(() => this.setDecorations(preset.decorations));
    if (preset.policy === "manual") {
      this.setPassthroughPolicy("manual");
      await attempt(() => this.applyPassthrough(false, true));
    } else {
      this.setPassthroughPolicy("auto");
    }

    let docked: boolean | undefined;
    if (mode === "taskbar_dock") {
      docked = await this.dockToTaskbar();
      if (!docked && this.errorState !== null) errors.push(this.errorState);
    }

    this.windowManager.setMode(mode);
    this.errorState = errors.length > 0 ? errors[errors.length - 1]! : null;
    return {
      mode,
      applied: errors.length === 0,
      state: this.snapshotState(this.driver.native),
      passthroughPolicy: this.policy,
      ...(docked !== undefined ? { docked } : {}),
      errors,
    };
  }

  public async dockToTaskbar(position?: TaskbarDockPosition): Promise<boolean> {
    let bounds: TaskbarBounds;
    try {
      bounds = await this.driver.dockToTaskbar(position);
    } catch (err) {
      this.errorState = messageOf(err);
      return false;
    }
    this.errorState = null;
    this.taskbarSupported = true;
    this.windowManager.updateTaskbarBounds(bounds);
    this.windowManager.setMode("taskbar_dock");
    this.emit(TaskbarResizedEvent.type, { bounds });
    return true;
  }

  public async getTaskbarBounds(): Promise<TaskbarBounds | null> {
    try {
      const bounds = await this.driver.getTaskbarBounds();
      this.errorState = null;
      this.taskbarSupported = true;
      return bounds;
    } catch (err) {
      this.errorState = messageOf(err);
      return null;
    }
  }

  // ── teardown ──────────────────────────────────────────────────────────

  public clear(): void {
    void this.restoreWindow().catch(() => { /* registrado em lastError */ });
  }

  public async restoreWindow(): Promise<OverlayWindowState> {
    this.detachPointer();
    this.policy = "manual";
    const initial = this.initialState ?? { alwaysOnTop: false, decorations: true, ignore: false };
    const errors: string[] = [];
    const attempt = async (fn: () => Promise<void>): Promise<void> => {
      try { await fn(); } catch (err) { errors.push(messageOf(err)); }
    };
    if (this.driver.native) {
      await attempt(() => this.applyPassthrough(initial.ignore, false));
      await attempt(() => this.setAlwaysOnTop(initial.alwaysOnTop));
      await attempt(() => this.setDecorations(initial.decorations));
    } else {
      this.passthroughState = initial.ignore;
      this.windowManager.setAlwaysOnTop(initial.alwaysOnTop);
      this.decorationsState = initial.decorations;
    }
    const alwaysOnTop = this.windowManager.isAlwaysOnTop;
    this.windowManager.clear();
    this.windowManager.setAlwaysOnTop(alwaysOnTop);
    this.cursorKnown = false;
    this.errorState = errors.length > 0 ? errors.join("; ") : null;
    return this.snapshotState(this.driver.native);
  }

  public dispose(): void {
    this.disposed = true;
    this.detachPointer();
  }

  // ── privados ──────────────────────────────────────────────────────────

  private async setDecorations(decorations: boolean): Promise<void> {
    if (!this.driver.native) {
      this.decorationsState = decorations;
      return;
    }
    await this.driver.setDecorations(decorations);
    this.decorationsState = decorations;
  }

  private async applyPassthrough(enabled: boolean, rethrow: boolean): Promise<void> {
    if (this.passthroughState === enabled) return;
    if (this.driver.native) {
      try {
        await this.driver.setIgnoreCursorEvents(enabled);
        this.errorState = null;
      } catch (err) {
        this.errorState = messageOf(err);
        if (rethrow) throw err;
        return;
      }
    }
    this.passthroughState = enabled;
    this.emit(PassthroughChangedEvent.type, {
      isIgnoringCursorEvents: enabled,
      mode: this.currentMode,
    });
  }

  private evaluate(): void {
    // Cursor ainda desconhecido: não liga passthrough "às cegas" (a janela
    // segue recebendo cliques até o primeiro movimento real).
    if (this.policy !== "auto" || this.disposed || !this.cursorKnown) return;
    this.lastEvaluateAt = this.now();
    const shouldIgnore = !this.cursorInside
      ? true
      : !this.performHitTest(this.cursorX, this.cursorY).hit;
    if (shouldIgnore === this.passthroughState || this.passthroughInFlight !== null) return;
    const pending = this.applyPassthrough(shouldIgnore, false).finally(() => {
      if (this.passthroughInFlight === pending) this.passthroughInFlight = null;
      // O cursor pode ter mudado enquanto o nativo respondia.
      if (this.errorState === null) this.evaluate();
    });
    this.passthroughInFlight = pending;
  }

  private pollNativeCursor(now: number): void {
    if (this.pollInFlight) return;
    this.pollInFlight = true;
    this.lastEvaluateAt = now;
    this.driver
      .getCursorPosition()
      .then((sample) => {
        this.cursorX = sample.x;
        this.cursorY = sample.y;
        this.cursorKnown = true;
        this.cursorInside = sample.inside;
        this.evaluate();
      })
      .catch((err: unknown) => {
        this.errorState = messageOf(err);
      })
      .finally(() => {
        this.pollInFlight = false;
      });
  }

  private attachPointer(): void {
    if (this.pointerAttached || !this.pointerTarget || this.disposed) return;
    this.pointerTarget.addEventListener("pointermove", this.onPointerMove, { passive: true });
    this.pointerTarget.addEventListener("mouseout", this.onPointerLeave);
    this.pointerTarget.addEventListener("blur", this.onPointerLeave);
    this.pointerAttached = true;
  }

  private detachPointer(): void {
    if (!this.pointerAttached || !this.pointerTarget) return;
    this.pointerTarget.removeEventListener("pointermove", this.onPointerMove);
    this.pointerTarget.removeEventListener("mouseout", this.onPointerLeave);
    this.pointerTarget.removeEventListener("blur", this.onPointerLeave);
    this.pointerAttached = false;
  }

  private snapshotState(native: boolean): OverlayWindowState {
    return {
      native,
      alwaysOnTop: this.windowManager.isAlwaysOnTop,
      decorations: this.decorationsState,
      ignoreCursorEvents: this.passthroughState,
      taskbarSupported: native && this.taskbarSupported,
      platform: native ? this.platform : "browser",
    };
  }

  private emit(type: string, payload: unknown): void {
    if (this.disposed) return;
    try {
      this.ctx.events.emit(type, payload);
    } catch {
      /* best-effort */
    }
  }
}

function messageOf(err: unknown): string {
  if (err instanceof OverlayNativeError || err instanceof Error) return err.message;
  return String(err);
}

function defaultNow(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}
