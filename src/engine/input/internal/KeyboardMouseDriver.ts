import type {
  Vector2D,
} from "../../../contracts/input/types";

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/** Pseudo-códigos de roda do mouse (borda de 1 frame: pressed + released). */
export const WHEEL_UP = "WheelUp";
export const WHEEL_DOWN = "WheelDown";
export const WHEEL_LEFT = "WheelLeft";
export const WHEEL_RIGHT = "WheelRight";

/** Pseudo-código "algum toque ativo" (botão digital). */
export const TOUCH_CODE = "Touch";

const WHEEL_LINE_PIXELS = 16;
const WHEEL_PAGE_PIXELS = 800;
const MAX_TOUCHES = 10;

const INTERACTIVE_MOUSE_TARGETS =
  "button, a[href], input, textarea, select, label, summary, option, [contenteditable=''], [contenteditable='true'], [role='button'], [role='slider'], [role='textbox'], [data-input-ignore]";

const EDITABLE_KEY_TARGETS =
  "input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='textbox'], [data-input-ignore]";

export type PointerLockChangeReason = "acquired" | "released" | "lost" | "error";

export interface PointerLockListener {
  (locked: boolean, reason: PointerLockChangeReason): void;
}

export interface KeyboardMouseFilterOptions {
  /** Ignora teclas digitadas com foco em campo editável (padrão true). */
  readonly ignoreEditableTargets?: boolean;
  /** Ignora cliques/roda sobre botões, links, campos e `[data-input-ignore]` (padrão true). */
  readonly ignoreInteractiveMouseTargets?: boolean;
  /** `preventDefault` em teclas usadas pelo mapa de binding, sem Ctrl/Alt/Meta (padrão true). */
  readonly preventDefaultForBoundKeys?: boolean;
}

interface MutableTouchPoint {
  id: number;
  x: number;
  y: number;
}

function closestMatch(target: EventTarget | null, selector: string): boolean {
  const candidate = target as { closest?: (selector: string) => unknown } | null;

  if (candidate === null || typeof candidate.closest !== "function") {
    return false;
  }

  try {
    return candidate.closest(selector) !== null;
  } catch {
    return false;
  }
}

/**
 * Teclado + mouse + roda + toque. Bordas por frame (`update()`) e por tick
 * fixo (`advanceTick()`); as bordas de tick são acumuladas direto nos
 * handlers DOM, então não dependem da ordem entre o pump de input e o loop.
 */
export class KeyboardMouseDriver {
  private readonly keysDown = new Set<string>();
  private readonly keysPressedPending = new Set<string>();
  private readonly keysReleasedPending = new Set<string>();
  private readonly keysPressedFrame = new Set<string>();
  private readonly keysReleasedFrame = new Set<string>();
  private readonly keysPressedTickPending = new Set<string>();
  private readonly keysReleasedTickPending = new Set<string>();
  private readonly keysPressedTick = new Set<string>();
  private readonly keysReleasedTick = new Set<string>();

  private readonly mouseButtonsDown = new Set<number>();
  private readonly mouseButtonsPressedPending = new Set<number>();
  private readonly mouseButtonsReleasedPending = new Set<number>();
  private readonly mouseButtonsPressedFrame = new Set<number>();
  private readonly mouseButtonsReleasedFrame = new Set<number>();
  private readonly mouseButtonsPressedTickPending = new Set<number>();
  private readonly mouseButtonsReleasedTickPending = new Set<number>();
  private readonly mouseButtonsPressedTick = new Set<number>();
  private readonly mouseButtonsReleasedTick = new Set<number>();

  private readonly mouseDeltaPending: Vector2D = { x: 0, y: 0 };
  private readonly mouseDeltaFrame: Vector2D = { x: 0, y: 0 };
  private readonly mouseDeltaTickPending: Vector2D = { x: 0, y: 0 };
  private readonly mouseDeltaTick: Vector2D = { x: 0, y: 0 };
  private readonly wheelPending: Vector2D = { x: 0, y: 0 };
  private readonly wheelFrame: Vector2D = { x: 0, y: 0 };
  private readonly wheelTickPending: Vector2D = { x: 0, y: 0 };
  private readonly wheelTick: Vector2D = { x: 0, y: 0 };
  private readonly pointerPosition: Vector2D = { x: 0, y: 0 };

  private readonly touches: MutableTouchPoint[] = [];
  private touchCount = 0;
  private touchActivityPending = false;
  private touchActivityFrame = false;

  private boundCodes: ReadonlySet<string> | null = null;
  private ignoreEditableTargets = true;
  private ignoreInteractiveMouseTargets = true;
  private preventDefaultForBoundKeys = true;

  private activityThisFrame = false;
  private isLocked = false;
  private exitRequested = false;
  private isBound = false;
  private disposed = false;
  private targetElement: HTMLElement | null = null;
  private pointerLockListener: PointerLockListener | null = null;

  public constructor() {
    for (let index = 0; index < MAX_TOUCHES; index += 1) {
      this.touches.push({ id: -1, x: 0, y: 0 });
    }

    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleMouseDown = this.handleMouseDown.bind(this);
    this.handleMouseUp = this.handleMouseUp.bind(this);
    this.handleWheel = this.handleWheel.bind(this);
    this.handleTouch = this.handleTouch.bind(this);
    this.handlePointerLockChange = this.handlePointerLockChange.bind(this);
    this.handlePointerLockError = this.handlePointerLockError.bind(this);
    this.handleContextMenu = this.handleContextMenu.bind(this);
    this.handleWindowBlur = this.handleWindowBlur.bind(this);
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
  }

  public attach(element: HTMLElement = document.body): void {
    if (this.disposed || this.isBound) {
      return;
    }

    this.targetElement = element;
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("mousemove", this.handleMouseMove);
    window.addEventListener("mousedown", this.handleMouseDown);
    window.addEventListener("mouseup", this.handleMouseUp);
    window.addEventListener("wheel", this.handleWheel, { passive: true });
    window.addEventListener("touchstart", this.handleTouch, { passive: true });
    window.addEventListener("touchmove", this.handleTouch, { passive: true });
    window.addEventListener("touchend", this.handleTouch, { passive: true });
    window.addEventListener("touchcancel", this.handleTouch, { passive: true });
    window.addEventListener("contextmenu", this.handleContextMenu);
    window.addEventListener("blur", this.handleWindowBlur);
    document.addEventListener("pointerlockchange", this.handlePointerLockChange);
    document.addEventListener("pointerlockerror", this.handlePointerLockError);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    this.isLocked = (document.pointerLockElement ?? null) !== null;
    this.isBound = true;
  }

  public detach(): void {
    if (!this.isBound) {
      return;
    }

    if (this.isPointerLocked) {
      this.exitPointerLock();
    }

    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("mousemove", this.handleMouseMove);
    window.removeEventListener("mousedown", this.handleMouseDown);
    window.removeEventListener("mouseup", this.handleMouseUp);
    window.removeEventListener("wheel", this.handleWheel);
    window.removeEventListener("touchstart", this.handleTouch);
    window.removeEventListener("touchmove", this.handleTouch);
    window.removeEventListener("touchend", this.handleTouch);
    window.removeEventListener("touchcancel", this.handleTouch);
    window.removeEventListener("contextmenu", this.handleContextMenu);
    window.removeEventListener("blur", this.handleWindowBlur);
    document.removeEventListener("pointerlockchange", this.handlePointerLockChange);
    document.removeEventListener("pointerlockerror", this.handlePointerLockError);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    this.clearAllState();
    this.targetElement = null;
    this.isBound = false;
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.detach();
    this.pointerLockListener = null;
    this.disposed = true;
  }

  public setPointerLockListener(listener: PointerLockListener | null): void {
    this.pointerLockListener = listener;
  }

  public setFilterOptions(options: KeyboardMouseFilterOptions): void {
    if (options.ignoreEditableTargets !== undefined) {
      this.ignoreEditableTargets = options.ignoreEditableTargets;
    }

    if (options.ignoreInteractiveMouseTargets !== undefined) {
      this.ignoreInteractiveMouseTargets = options.ignoreInteractiveMouseTargets;
    }

    if (options.preventDefaultForBoundKeys !== undefined) {
      this.preventDefaultForBoundKeys = options.preventDefaultForBoundKeys;
    }
  }

  /** Códigos do mapa de binding atual (para `preventDefault`). */
  public setBoundCodes(codes: ReadonlySet<string> | null): void {
    this.boundCodes = codes;
  }

  public update(): void {
    if (this.disposed) {
      return;
    }

    this.keysPressedFrame.clear();
    this.keysReleasedFrame.clear();
    this.mouseButtonsPressedFrame.clear();
    this.mouseButtonsReleasedFrame.clear();

    for (const code of this.keysPressedPending) {
      this.keysPressedFrame.add(code);
    }

    for (const code of this.keysReleasedPending) {
      this.keysReleasedFrame.add(code);
    }

    for (const button of this.mouseButtonsPressedPending) {
      this.mouseButtonsPressedFrame.add(button);
    }

    for (const button of this.mouseButtonsReleasedPending) {
      this.mouseButtonsReleasedFrame.add(button);
    }

    this.mouseDeltaFrame.x = this.mouseDeltaPending.x;
    this.mouseDeltaFrame.y = this.mouseDeltaPending.y;
    this.wheelFrame.x = this.wheelPending.x;
    this.wheelFrame.y = this.wheelPending.y;
    this.touchActivityFrame = this.touchActivityPending;

    this.activityThisFrame =
      sizeWithoutTouch(this.keysDown) > 0 ||
      sizeWithoutTouch(this.keysPressedFrame) > 0 ||
      sizeWithoutTouch(this.keysReleasedFrame) > 0 ||
      this.mouseButtonsDown.size > 0 ||
      this.mouseButtonsPressedFrame.size > 0 ||
      this.mouseButtonsReleasedFrame.size > 0 ||
      this.mouseDeltaFrame.x !== 0 ||
      this.mouseDeltaFrame.y !== 0 ||
      this.wheelFrame.x !== 0 ||
      this.wheelFrame.y !== 0;

    this.keysPressedPending.clear();
    this.keysReleasedPending.clear();
    this.mouseButtonsPressedPending.clear();
    this.mouseButtonsReleasedPending.clear();
    this.mouseDeltaPending.x = 0;
    this.mouseDeltaPending.y = 0;
    this.wheelPending.x = 0;
    this.wheelPending.y = 0;
    this.touchActivityPending = false;
  }

  /** Fronteira de tick fixo: publica as bordas/deltas acumulados desde o tick anterior. */
  public advanceTick(): void {
    copySet(this.keysPressedTickPending, this.keysPressedTick);
    copySet(this.keysReleasedTickPending, this.keysReleasedTick);
    copySet(this.mouseButtonsPressedTickPending, this.mouseButtonsPressedTick);
    copySet(this.mouseButtonsReleasedTickPending, this.mouseButtonsReleasedTick);
    this.mouseDeltaTick.x = this.mouseDeltaTickPending.x;
    this.mouseDeltaTick.y = this.mouseDeltaTickPending.y;
    this.wheelTick.x = this.wheelTickPending.x;
    this.wheelTick.y = this.wheelTickPending.y;
    this.discardPendingTickEdges();
  }

  /** Descarta bordas ainda não publicadas para o tick (pausa). */
  public discardPendingTickEdges(): void {
    this.keysPressedTickPending.clear();
    this.keysReleasedTickPending.clear();
    this.mouseButtonsPressedTickPending.clear();
    this.mouseButtonsReleasedTickPending.clear();
    this.mouseDeltaTickPending.x = 0;
    this.mouseDeltaTickPending.y = 0;
    this.wheelTickPending.x = 0;
    this.wheelTickPending.y = 0;
  }

  public isKeyDown(code: string): boolean {
    return this.keysDown.has(code);
  }

  public isKeyPressed(code: string): boolean {
    return this.keysPressedFrame.has(code);
  }

  public isKeyReleased(code: string): boolean {
    return this.keysReleasedFrame.has(code);
  }

  public isKeyPressedInTick(code: string): boolean {
    return this.keysPressedTick.has(code);
  }

  public isKeyReleasedInTick(code: string): boolean {
    return this.keysReleasedTick.has(code);
  }

  public isMouseButtonDown(button: number): boolean {
    return this.mouseButtonsDown.has(button);
  }

  public isMouseButtonPressed(button: number): boolean {
    return this.mouseButtonsPressedFrame.has(button);
  }

  public isMouseButtonReleased(button: number): boolean {
    return this.mouseButtonsReleasedFrame.has(button);
  }

  public isMouseButtonPressedInTick(button: number): boolean {
    return this.mouseButtonsPressedTick.has(button);
  }

  public isMouseButtonReleasedInTick(button: number): boolean {
    return this.mouseButtonsReleasedTick.has(button);
  }

  public getMouseDelta(): Readonly<Vector2D> {
    return this.mouseDeltaFrame;
  }

  public getTickMouseDelta(): Readonly<Vector2D> {
    return this.mouseDeltaTick;
  }

  /** Roda acumulada no frame, em pixels (y > 0 = rolar para baixo). */
  public getWheelDelta(): Readonly<Vector2D> {
    return this.wheelFrame;
  }

  public getTickWheelDelta(): Readonly<Vector2D> {
    return this.wheelTick;
  }

  /** Última posição do ponteiro em coordenadas de viewport (clientX/Y). */
  public getPointerPosition(): Readonly<Vector2D> {
    return this.pointerPosition;
  }

  public get activeTouchCount(): number {
    return this.touchCount;
  }

  /** Posição (clientX/Y) do i-ésimo toque ativo; null se não houver. */
  public getTouchPoint(index: number): Readonly<Vector2D> | null {
    if (!Number.isInteger(index) || index < 0) {
      return null;
    }

    let seen = 0;

    for (let slot = 0; slot < this.touches.length; slot += 1) {
      const touch = this.touches[slot];

      if (touch === undefined || touch.id < 0) {
        continue;
      }

      if (seen === index) {
        return touch;
      }

      seen += 1;
    }

    return null;
  }

  public get hasActivityThisFrame(): boolean {
    return this.activityThisFrame;
  }

  public get hasTouchActivityThisFrame(): boolean {
    return this.touchActivityFrame;
  }

  public get isPointerLocked(): boolean {
    return this.isLocked;
  }

  public async requestPointerLock(element?: HTMLElement): Promise<boolean> {
    if (this.disposed) {
      return false;
    }

    const target = element ?? this.targetElement ?? document.body;
    const request = target.requestPointerLock;

    if (typeof request !== "function") {
      return false;
    }

    try {
      this.exitRequested = false;
      await request.call(target);
      return true;
    } catch (error: unknown) {
      console.warn("[KeyboardMouseDriver] Pointer Lock recusado:", error);
      return false;
    }
  }

  public exitPointerLock(): void {
    const exit = document.exitPointerLock;
    const lockedElement = document.pointerLockElement ?? null;

    if (typeof exit === "function" && lockedElement !== null) {
      this.exitRequested = true;
      exit.call(document);
    }
  }

  private shouldIgnoreKeyTarget(event: Event): boolean {
    return this.ignoreEditableTargets && closestMatch(event.target, EDITABLE_KEY_TARGETS);
  }

  private shouldIgnoreMouseTarget(event: Event): boolean {
    return (
      this.ignoreInteractiveMouseTargets &&
      !this.isLocked &&
      closestMatch(event.target, INTERACTIVE_MOUSE_TARGETS)
    );
  }

  private handleKeyDown(event: KeyboardEvent): void {
    const code = event.code;

    if (code.length === 0 || this.shouldIgnoreKeyTarget(event)) {
      return;
    }

    if (
      this.preventDefaultForBoundKeys &&
      this.boundCodes !== null &&
      this.boundCodes.has(code) &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
    }

    if (event.repeat || this.keysDown.has(code)) {
      return;
    }

    this.keysDown.add(code);
    this.keysPressedPending.add(code);
    this.keysPressedTickPending.add(code);
  }

  private handleKeyUp(event: KeyboardEvent): void {
    const code = event.code;
    const wasDown = this.keysDown.delete(code);

    if (wasDown) {
      this.keysReleasedPending.add(code);
      this.keysReleasedTickPending.add(code);

      if (
        this.preventDefaultForBoundKeys &&
        this.boundCodes !== null &&
        this.boundCodes.has(code)
      ) {
        event.preventDefault();
      }
    }
  }

  private handleMouseMove(event: MouseEvent): void {
    const dx = finiteOrZero(event.movementX);
    const dy = finiteOrZero(event.movementY);
    this.mouseDeltaPending.x += dx;
    this.mouseDeltaPending.y += dy;
    this.mouseDeltaTickPending.x += dx;
    this.mouseDeltaTickPending.y += dy;
    this.pointerPosition.x = finiteOrZero(event.clientX);
    this.pointerPosition.y = finiteOrZero(event.clientY);
  }

  private handleMouseDown(event: MouseEvent): void {
    const button = event.button;

    if (
      !Number.isInteger(button) ||
      button < 0 ||
      this.mouseButtonsDown.has(button) ||
      this.shouldIgnoreMouseTarget(event)
    ) {
      return;
    }

    this.mouseButtonsDown.add(button);
    this.mouseButtonsPressedPending.add(button);
    this.mouseButtonsPressedTickPending.add(button);
  }

  private handleMouseUp(event: MouseEvent): void {
    const button = event.button;
    const wasDown = this.mouseButtonsDown.delete(button);

    if (wasDown) {
      this.mouseButtonsReleasedPending.add(button);
      this.mouseButtonsReleasedTickPending.add(button);
    }
  }

  private handleWheel(event: WheelEvent): void {
    if (this.shouldIgnoreMouseTarget(event)) {
      return;
    }

    const scale =
      event.deltaMode === 1
        ? WHEEL_LINE_PIXELS
        : event.deltaMode === 2
          ? WHEEL_PAGE_PIXELS
          : 1;
    const dx = finiteOrZero(event.deltaX) * scale;
    const dy = finiteOrZero(event.deltaY) * scale;

    this.wheelPending.x += dx;
    this.wheelPending.y += dy;
    this.wheelTickPending.x += dx;
    this.wheelTickPending.y += dy;

    if (dy < 0) {
      this.pulseCode(WHEEL_UP);
    } else if (dy > 0) {
      this.pulseCode(WHEEL_DOWN);
    }

    if (dx < 0) {
      this.pulseCode(WHEEL_LEFT);
    } else if (dx > 0) {
      this.pulseCode(WHEEL_RIGHT);
    }
  }

  /** Borda instantânea (pressed + released no mesmo frame/tick, nunca "down"). */
  private pulseCode(code: string): void {
    this.keysPressedPending.add(code);
    this.keysReleasedPending.add(code);
    this.keysPressedTickPending.add(code);
    this.keysReleasedTickPending.add(code);
  }

  private handleTouch(event: TouchEvent): void {
    const list = event.touches;
    const length = list === undefined || list === null ? 0 : list.length;

    for (let slot = 0; slot < this.touches.length; slot += 1) {
      const point = this.touches[slot];

      if (point !== undefined) {
        point.id = -1;
      }
    }

    let count = 0;

    for (let index = 0; index < length && count < this.touches.length; index += 1) {
      const touch = list.item(index);
      const point = this.touches[count];

      if (touch === null || point === undefined) {
        continue;
      }

      point.id = touch.identifier;
      point.x = finiteOrZero(touch.clientX);
      point.y = finiteOrZero(touch.clientY);
      count += 1;
    }

    const wasTouching = this.touchCount > 0;
    this.touchCount = count;
    this.touchActivityPending = true;

    if (count > 0 && !wasTouching) {
      this.keysDown.add(TOUCH_CODE);
      this.keysPressedPending.add(TOUCH_CODE);
      this.keysPressedTickPending.add(TOUCH_CODE);
    } else if (count === 0 && wasTouching) {
      this.keysDown.delete(TOUCH_CODE);
      this.keysReleasedPending.add(TOUCH_CODE);
      this.keysReleasedTickPending.add(TOUCH_CODE);
    }
  }

  private handleContextMenu(event: MouseEvent): void {
    if (this.isLocked) {
      event.preventDefault();
    }
  }

  private handlePointerLockChange(): void {
    const lockedElement = document.pointerLockElement ?? null;
    const locked = lockedElement !== null;

    if (locked === this.isLocked) {
      return;
    }

    this.isLocked = locked;
    let reason: PointerLockChangeReason = "acquired";

    if (!locked) {
      reason = this.exitRequested ? "released" : "lost";
      this.exitRequested = false;
      // Perder a trava (ESC do navegador) não deve deixar botões presos.
      this.releaseMouseButtons();
    }

    const listener = this.pointerLockListener;

    if (listener !== null) {
      listener(locked, reason);
    }
  }

  private handlePointerLockError(): void {
    const listener = this.pointerLockListener;

    if (listener !== null) {
      listener(this.isLocked, "error");
    }
  }

  private handleWindowBlur(): void {
    this.releaseAllContinuousState();
  }

  private handleVisibilityChange(): void {
    if (document.visibilityState === "hidden") {
      this.releaseAllContinuousState();
    }
  }

  private releaseMouseButtons(): void {
    for (const button of this.mouseButtonsDown) {
      this.mouseButtonsReleasedPending.add(button);
      this.mouseButtonsReleasedTickPending.add(button);
    }

    this.mouseButtonsDown.clear();
  }

  private releaseAllContinuousState(): void {
    for (const code of this.keysDown) {
      this.keysReleasedPending.add(code);
      this.keysReleasedTickPending.add(code);
    }

    this.releaseMouseButtons();
    this.keysDown.clear();
    this.touchCount = 0;

    for (let slot = 0; slot < this.touches.length; slot += 1) {
      const point = this.touches[slot];

      if (point !== undefined) {
        point.id = -1;
      }
    }

    this.mouseDeltaPending.x = 0;
    this.mouseDeltaPending.y = 0;
  }

  private clearAllState(): void {
    this.keysDown.clear();
    this.keysPressedPending.clear();
    this.keysReleasedPending.clear();
    this.keysPressedFrame.clear();
    this.keysReleasedFrame.clear();
    this.keysPressedTick.clear();
    this.keysReleasedTick.clear();
    this.mouseButtonsDown.clear();
    this.mouseButtonsPressedPending.clear();
    this.mouseButtonsReleasedPending.clear();
    this.mouseButtonsPressedFrame.clear();
    this.mouseButtonsReleasedFrame.clear();
    this.mouseButtonsPressedTick.clear();
    this.mouseButtonsReleasedTick.clear();
    this.discardPendingTickEdges();
    this.mouseDeltaPending.x = 0;
    this.mouseDeltaPending.y = 0;
    this.mouseDeltaFrame.x = 0;
    this.mouseDeltaFrame.y = 0;
    this.mouseDeltaTick.x = 0;
    this.mouseDeltaTick.y = 0;
    this.wheelPending.x = 0;
    this.wheelPending.y = 0;
    this.wheelFrame.x = 0;
    this.wheelFrame.y = 0;
    this.wheelTick.x = 0;
    this.wheelTick.y = 0;
    this.touchCount = 0;
    this.touchActivityPending = false;
    this.touchActivityFrame = false;
    this.activityThisFrame = false;
    this.isLocked = false;
    this.exitRequested = false;
  }
}

function copySet<T>(source: Set<T>, target: Set<T>): void {
  target.clear();

  for (const value of source) {
    target.add(value);
  }
}

function sizeWithoutTouch(set: Set<string>): number {
  return set.has(TOUCH_CODE) ? set.size - 1 : set.size;
}
