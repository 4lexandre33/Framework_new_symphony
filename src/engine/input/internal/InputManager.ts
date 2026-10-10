import type {
  InputApi,
} from "../../../tokens/input";

import type {
  GamepadConnectionPayload,
  InputActionEventOptions,
  InputActionPayload,
  InputBindingMap,
  InputDeviceChangedPayload,
  InputDeviceType,
  InputFilterOptions,
  InputGamepadInfo,
  PointerLockChangeReason,
  PointerLockChangedPayload,
  Vector2D,
} from "../../../contracts/input/types";

import {
  ANY_GAMEPAD,
  GamepadDriver,
} from "./GamepadDriver";

import {
  KeyboardMouseDriver,
} from "./KeyboardMouseDriver";

const KEYBOARD_MOUSE_DEVICE_NAME = "Keyboard + Mouse";
const TOUCH_DEVICE_NAME = "Touch";
const AXIS_HALF_DOWN_THRESHOLD = 0.5;

const DEFAULT_BINDING_MAP: InputBindingMap = {
  actions: {
    Jump: ["Space", "GamepadButton0"],
    Interact: ["KeyE", "GamepadButton2"],
    Attack: ["Mouse0", "GamepadButton1"],
  },

  axes: {
    MoveForward: {
      positive: "KeyW",
      negative: "KeyS",
      positiveAlt: ["GamepadButton12", "GamepadAxis1-"],
      negativeAlt: ["GamepadButton13", "GamepadAxis1+"],
    },

    MoveRight: {
      positive: "KeyD",
      negative: "KeyA",
      positiveAlt: ["GamepadButton15", "GamepadAxis0+"],
      negativeAlt: ["GamepadButton14", "GamepadAxis0-"],
    },

    LookRight: {
      positive: "GamepadAxis2+",
      negative: "GamepadAxis2-",
    },

    LookUp: {
      positive: "GamepadAxis3-",
      negative: "GamepadAxis3+",
    },
  },
};

/** Eixos que, sem `*Alt` no mapa do jogo, recebem o analógico esquerdo (compatibilidade). */
const LEGACY_STICK_AXES: Readonly<Record<string, readonly [string, string]>> = {
  MoveForward: ["GamepadAxis1-", "GamepadAxis1+"],
  MoveRight: ["GamepadAxis0+", "GamepadAxis0-"],
};

export interface InputEventSink {
  onAction(payload: InputActionPayload): void;
  onDeviceChanged(payload: InputDeviceChangedPayload): void;
  onPointerLockChanged?(payload: PointerLockChangedPayload): void;
  onGamepadConnection?(payload: GamepadConnectionPayload): void;
}

const enum BindingKind {
  Key = 0,
  Mouse = 1,
  GamepadButton = 2,
  GamepadAxisHalf = 3,
}

/** Binding pré-compilado no `setBindingMap` (zero parsing por frame). */
interface CompiledBinding {
  readonly kind: BindingKind;
  readonly code: string;
  readonly index: number;
  readonly pad: number;
  readonly sign: number;
  /** Estado de borda (só meio-eixos de gamepad, cujo "down" é derivado). */
  down: boolean;
  pressedFrame: boolean;
  releasedFrame: boolean;
  pressedTickPending: boolean;
  releasedTickPending: boolean;
  pressedTick: boolean;
  releasedTick: boolean;
}

interface ActionRuntimeEntry {
  readonly action: string;
  readonly bindings: readonly CompiledBinding[];
  readonly keyboardPressed: InputActionPayload;
  readonly keyboardHeld: InputActionPayload;
  readonly keyboardReleased: InputActionPayload;
  readonly gamepadPressed: InputActionPayload;
  readonly gamepadHeld: InputActionPayload;
  readonly gamepadReleased: InputActionPayload;
  readonly touchPressed: InputActionPayload;
  readonly touchHeld: InputActionPayload;
  readonly touchReleased: InputActionPayload;
}

interface AxisRuntimeEntry {
  readonly positive: readonly CompiledBinding[];
  readonly negative: readonly CompiledBinding[];
}

function assertNonEmpty(value: string, label: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RangeError(`${label} não pode ser vazio.`);
  }
}

function createActionPayload(
  action: string,
  state: InputActionPayload["state"],
  value: number,
  device: InputDeviceType,
): InputActionPayload {
  return Object.freeze({ action, state, value, device });
}

function parseDigits(source: string, start: number, end: number): number | null {
  if (end <= start) {
    return null;
  }

  let value = 0;

  for (let index = start; index < end; index += 1) {
    const code = source.charCodeAt(index);

    if (code < 48 || code > 57) {
      return null;
    }

    value = value * 10 + (code - 48);
  }

  return value;
}

function compileBinding(binding: string): CompiledBinding {
  let kind = BindingKind.Key;
  let index = -1;
  let pad = ANY_GAMEPAD;
  let sign = 1;

  if (binding.startsWith("Mouse")) {
    const button = parseDigits(binding, 5, binding.length);

    if (button !== null) {
      kind = BindingKind.Mouse;
      index = button;
    }
  } else if (binding.startsWith("Gamepad")) {
    let cursor = 7;

    while (cursor < binding.length) {
      const code = binding.charCodeAt(cursor);

      if (code < 48 || code > 57) {
        break;
      }

      cursor += 1;
    }

    const padIndex = cursor > 7 ? parseDigits(binding, 7, cursor) : null;
    const rest = binding.slice(cursor);

    if (rest.startsWith("Button")) {
      const button = parseDigits(rest, 6, rest.length);

      if (button !== null) {
        kind = BindingKind.GamepadButton;
        index = button;
        pad = padIndex ?? ANY_GAMEPAD;
      }
    } else if (rest.startsWith("Axis") && (rest.endsWith("+") || rest.endsWith("-"))) {
      const axis = parseDigits(rest, 4, rest.length - 1);

      if (axis !== null) {
        kind = BindingKind.GamepadAxisHalf;
        index = axis;
        pad = padIndex ?? ANY_GAMEPAD;
        sign = rest.endsWith("-") ? -1 : 1;
      }
    }
  }

  return {
    kind,
    code: binding,
    index,
    pad,
    sign,
    down: false,
    pressedFrame: false,
    releasedFrame: false,
    pressedTickPending: false,
    releasedTickPending: false,
    pressedTick: false,
    releasedTick: false,
  };
}

function isGamepadBinding(binding: CompiledBinding): boolean {
  return (
    binding.kind === BindingKind.GamepadButton ||
    binding.kind === BindingKind.GamepadAxisHalf
  );
}

const POINTER_LOCK_PAYLOADS: Readonly<Record<string, PointerLockChangedPayload>> = {
  "true:acquired": Object.freeze({ locked: true, reason: "acquired" }),
  "false:released": Object.freeze({ locked: false, reason: "released" }),
  "false:lost": Object.freeze({ locked: false, reason: "lost" }),
  "false:error": Object.freeze({ locked: false, reason: "error" }),
  "true:error": Object.freeze({ locked: true, reason: "error" }),
};

export class InputManager implements InputApi {
  private readonly kmDriver: KeyboardMouseDriver;
  private readonly gamepadDriver: GamepadDriver;
  private eventSink: InputEventSink | null;
  private currentDevice: InputDeviceType = "keyboard_mouse";
  private actionEntries: readonly ActionRuntimeEntry[] = [];
  private readonly actionsByName = new Map<string, ActionRuntimeEntry>();
  private readonly axesByName = new Map<string, AxisRuntimeEntry>();
  private axisHalfBindings: CompiledBinding[] = [];
  private emitHeld = true;
  private framePumpOwned = false;
  private warnedExternalUpdate = false;
  private tickSynchronized = false;
  private disposed = false;

  public constructor(
    eventSink: InputEventSink | null = null,
    kmDriver: KeyboardMouseDriver = new KeyboardMouseDriver(),
    gamepadDriver: GamepadDriver = new GamepadDriver(),
  ) {
    this.eventSink = eventSink;
    this.kmDriver = kmDriver;
    this.gamepadDriver = gamepadDriver;
    this.installBindingMap(DEFAULT_BINDING_MAP);

    this.kmDriver.setPointerLockListener((locked: boolean, reason: PointerLockChangeReason): void => {
      const sink = this.eventSink;

      if (sink?.onPointerLockChanged !== undefined) {
        const payload = POINTER_LOCK_PAYLOADS[`${String(locked)}:${reason}`];

        if (payload !== undefined) {
          sink.onPointerLockChanged(payload);
        }
      }
    });

    this.gamepadDriver.setConnectionListener((index: number, id: string, connected: boolean): void => {
      const sink = this.eventSink;

      if (sink?.onGamepadConnection !== undefined) {
        sink.onGamepadConnection(Object.freeze({ index, id, connected }));
      }
    });

    this.kmDriver.attach();
    this.gamepadDriver.attach();
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.eventSink = null;
    this.kmDriver.dispose();
    this.gamepadDriver.dispose();
    this.currentDevice = "keyboard_mouse";
  }

  public get activeDevice(): InputDeviceType {
    return this.currentDevice;
  }

  public get isPointerLocked(): boolean {
    return !this.disposed && this.kmDriver.isPointerLocked;
  }

  public get isTickSynchronized(): boolean {
    return this.tickSynchronized;
  }

  /**
   * Avanço de frame público. Ignorado quando um InputFramePump é o dono
   * (plugin), para que jogos não apaguem bordas/delta (G49).
   */
  public update(): void {
    if (this.disposed) {
      return;
    }

    if (this.framePumpOwned) {
      if (!this.warnedExternalUpdate) {
        this.warnedExternalUpdate = true;
        console.warn(
          "[InputManager] update() ignorado: o frame de input já é avançado pela engine.",
        );
      }

      return;
    }

    this.advanceFrame();
  }

  /**
   * Alvo do InputFramePump: a partir daqui só o pump avança o frame e
   * `InputApi.update()` vira no-op.
   */
  public claimFramePump(): { update(): void } {
    this.framePumpOwned = true;

    return {
      update: (): void => {
        this.advanceFrame();
      },
    };
  }

  /** Avança um frame de input (snapshot de bordas + eventos). */
  public advanceFrame(): void {
    if (this.disposed) {
      return;
    }

    this.kmDriver.update();
    this.gamepadDriver.update();
    this.updateAxisHalfEdges();
    this.updateActiveDevice();
    this.publishActionSnapshot();
  }

  /** Fronteira de tick fixo (chamada pelo plugin em `game.loop.tick`). */
  public advanceTick(): void {
    if (this.disposed) {
      return;
    }

    if (!this.tickSynchronized) {
      // Primeiro tick: até aqui as consultas *InTick usavam o frame; o que
      // já foi visto assim não pode reaparecer no snapshot do tick (sem
      // duplicar borda; uma pressão anterior ao 1º tick pode se perder).
      this.tickSynchronized = true;
      this.discardPendingTickEdges();
    }

    this.kmDriver.advanceTick();
    this.gamepadDriver.advanceTick();

    for (let index = 0; index < this.axisHalfBindings.length; index += 1) {
      const binding = this.axisHalfBindings[index];

      if (binding !== undefined) {
        binding.pressedTick = binding.pressedTickPending;
        binding.releasedTick = binding.releasedTickPending;
        binding.pressedTickPending = false;
        binding.releasedTickPending = false;
      }
    }
  }

  /** Descarta bordas ainda não vistas por um tick (pausa do game loop). */
  public discardPendingTickEdges(): void {
    if (this.disposed) {
      return;
    }

    this.kmDriver.discardPendingTickEdges();
    this.gamepadDriver.discardPendingTickEdges();

    for (let index = 0; index < this.axisHalfBindings.length; index += 1) {
      const binding = this.axisHalfBindings[index];

      if (binding !== undefined) {
        binding.pressedTickPending = false;
        binding.releasedTickPending = false;
      }
    }
  }

  public isActionPressed(action: string): boolean {
    return this.anyBinding(action, 0);
  }

  public isActionHeld(action: string): boolean {
    return this.anyBinding(action, 1);
  }

  public isActionReleased(action: string): boolean {
    return this.releasedAction(action, false);
  }

  public isActionPressedInTick(action: string): boolean {
    if (!this.tickSynchronized) {
      return this.isActionPressed(action);
    }

    return this.anyBinding(action, 3);
  }

  public isActionReleasedInTick(action: string): boolean {
    if (!this.tickSynchronized) {
      return this.isActionReleased(action);
    }

    return this.releasedAction(action, true);
  }

  public getActionValue(action: string): number {
    const entry = this.actionsByName.get(action);

    if (entry === undefined) {
      return 0;
    }

    return this.maxValue(entry.bindings);
  }

  public getAxis(axisName: string): number {
    const axis = this.axesByName.get(axisName);

    if (axis === undefined) {
      return 0;
    }

    const value = this.maxValue(axis.positive) - this.maxValue(axis.negative);

    if (value > 1) {
      return 1;
    }

    if (value < -1) {
      return -1;
    }

    return value;
  }

  public getMouseDelta(): Readonly<Vector2D> {
    return this.kmDriver.getMouseDelta();
  }

  public getTickMouseDelta(): Readonly<Vector2D> {
    return this.tickSynchronized
      ? this.kmDriver.getTickMouseDelta()
      : this.kmDriver.getMouseDelta();
  }

  public getWheelDelta(): Readonly<Vector2D> {
    return this.kmDriver.getWheelDelta();
  }

  public getTickWheelDelta(): Readonly<Vector2D> {
    return this.tickSynchronized
      ? this.kmDriver.getTickWheelDelta()
      : this.kmDriver.getWheelDelta();
  }

  public getPointerPosition(): Readonly<Vector2D> {
    return this.kmDriver.getPointerPosition();
  }

  public getTouchCount(): number {
    return this.kmDriver.activeTouchCount;
  }

  public getTouchPosition(index: number): Readonly<Vector2D> | null {
    return this.kmDriver.getTouchPoint(index);
  }

  public getConnectedGamepads(): readonly InputGamepadInfo[] {
    const target: Array<{ index: number; id: string; buttons: number; axes: number }> = [];
    this.gamepadDriver.collectConnected(target);
    return target;
  }

  public getGamepadAxis(axisIndex: number, gamepadIndex?: number): number {
    return this.gamepadDriver.getAxisValue(axisIndex, gamepadIndex ?? ANY_GAMEPAD);
  }

  public getGamepadButtonValue(buttonIndex: number, gamepadIndex?: number): number {
    return this.gamepadDriver.getButtonValue(buttonIndex, gamepadIndex ?? ANY_GAMEPAD);
  }

  public get gamepadDeadZone(): number {
    return this.gamepadDriver.deadZone;
  }

  public setGamepadDeadZone(deadZone: number): boolean {
    try {
      this.gamepadDriver.setDeadzone(deadZone);
      return true;
    } catch {
      return false;
    }
  }

  public setFilterOptions(options: InputFilterOptions): void {
    this.kmDriver.setFilterOptions(options);
  }

  public setActionEventOptions(options: InputActionEventOptions): void {
    if (options.emitHeld !== undefined) {
      this.emitHeld = options.emitHeld;
    }
  }

  public setBindingMap(map: InputBindingMap): void {
    if (this.disposed) {
      return;
    }

    this.installBindingMap(map);
  }

  public async requestPointerLock(element?: HTMLElement): Promise<boolean> {
    if (this.disposed) {
      return false;
    }

    return this.kmDriver.requestPointerLock(element);
  }

  public exitPointerLock(): void {
    if (this.disposed) {
      return;
    }

    this.kmDriver.exitPointerLock();
  }

  public getActiveDeviceName(): string {
    if (this.currentDevice === "gamepad") {
      return this.gamepadDriver.getGamepadName();
    }

    if (this.currentDevice === "touch") {
      return TOUCH_DEVICE_NAME;
    }

    return KEYBOARD_MOUSE_DEVICE_NAME;
  }

  private anyBinding(action: string, kind: number): boolean {
    const entry = this.actionsByName.get(action);

    if (entry === undefined) {
      return false;
    }

    const bindings = entry.bindings;

    for (let index = 0; index < bindings.length; index += 1) {
      const binding = bindings[index];

      if (binding !== undefined && this.bindingFlag(binding, kind)) {
        return true;
      }
    }

    return false;
  }

  private releasedAction(action: string, inTick: boolean): boolean {
    const entry = this.actionsByName.get(action);

    if (entry === undefined) {
      return false;
    }

    let released = false;
    const bindings = entry.bindings;

    for (let index = 0; index < bindings.length; index += 1) {
      const binding = bindings[index];

      if (binding === undefined) {
        continue;
      }

      if (this.bindingFlag(binding, 1)) {
        return false;
      }

      if (this.bindingFlag(binding, inTick ? 4 : 2)) {
        released = true;
      }
    }

    return released;
  }

  /** kind: 0 pressed(frame), 1 held, 2 released(frame), 3 pressed(tick), 4 released(tick). */
  private bindingFlag(binding: CompiledBinding, kind: number): boolean {
    switch (binding.kind) {
      case BindingKind.Mouse:
        return kind === 0
          ? this.kmDriver.isMouseButtonPressed(binding.index)
          : kind === 1
            ? this.kmDriver.isMouseButtonDown(binding.index)
            : kind === 2
              ? this.kmDriver.isMouseButtonReleased(binding.index)
              : kind === 3
                ? this.kmDriver.isMouseButtonPressedInTick(binding.index)
                : this.kmDriver.isMouseButtonReleasedInTick(binding.index);
      case BindingKind.GamepadButton:
        return kind === 0
          ? this.gamepadDriver.isButtonPressed(binding.index, binding.pad)
          : kind === 1
            ? this.gamepadDriver.isButtonDown(binding.index, binding.pad)
            : kind === 2
              ? this.gamepadDriver.isButtonReleased(binding.index, binding.pad)
              : kind === 3
                ? this.gamepadDriver.isButtonPressedInTick(binding.index, binding.pad)
                : this.gamepadDriver.isButtonReleasedInTick(binding.index, binding.pad);
      case BindingKind.GamepadAxisHalf:
        return kind === 0
          ? binding.pressedFrame
          : kind === 1
            ? binding.down
            : kind === 2
              ? binding.releasedFrame
              : kind === 3
                ? binding.pressedTick
                : binding.releasedTick;
      default:
        return kind === 0
          ? this.kmDriver.isKeyPressed(binding.code)
          : kind === 1
            ? this.kmDriver.isKeyDown(binding.code)
            : kind === 2
              ? this.kmDriver.isKeyReleased(binding.code)
              : kind === 3
                ? this.kmDriver.isKeyPressedInTick(binding.code)
                : this.kmDriver.isKeyReleasedInTick(binding.code);
    }
  }

  private bindingValue(binding: CompiledBinding): number {
    switch (binding.kind) {
      case BindingKind.Mouse:
        return this.kmDriver.isMouseButtonDown(binding.index) ? 1 : 0;
      case BindingKind.GamepadButton:
        return this.gamepadDriver.getButtonValue(binding.index, binding.pad);
      case BindingKind.GamepadAxisHalf: {
        const value = this.gamepadDriver.getAxisValue(binding.index, binding.pad) * binding.sign;
        return value > 0 ? value : 0;
      }
      default:
        return this.kmDriver.isKeyDown(binding.code) ? 1 : 0;
    }
  }

  private maxValue(bindings: readonly CompiledBinding[]): number {
    let best = 0;

    for (let index = 0; index < bindings.length; index += 1) {
      const binding = bindings[index];

      if (binding === undefined) {
        continue;
      }

      const value = this.bindingValue(binding);

      if (value > best) {
        best = value;
      }
    }

    return best > 1 ? 1 : best;
  }

  private updateAxisHalfEdges(): void {
    for (let index = 0; index < this.axisHalfBindings.length; index += 1) {
      const binding = this.axisHalfBindings[index];

      if (binding === undefined) {
        continue;
      }

      const nextDown = this.bindingValue(binding) >= AXIS_HALF_DOWN_THRESHOLD;
      binding.pressedFrame = nextDown && !binding.down;
      binding.releasedFrame = !nextDown && binding.down;

      if (binding.pressedFrame) {
        binding.pressedTickPending = true;
      }

      if (binding.releasedFrame) {
        binding.releasedTickPending = true;
      }

      binding.down = nextDown;
    }
  }

  private updateActiveDevice(): void {
    const previousDevice = this.currentDevice;

    if (this.kmDriver.hasTouchActivityThisFrame) {
      this.currentDevice = "touch";
    } else if (this.kmDriver.hasActivityThisFrame) {
      this.currentDevice = "keyboard_mouse";
    } else if (this.gamepadDriver.isConnected && this.gamepadDriver.hasActivityThisFrame) {
      this.currentDevice = "gamepad";
    } else if (this.currentDevice === "gamepad" && !this.gamepadDriver.isConnected) {
      this.currentDevice = "keyboard_mouse";
    }

    if (previousDevice !== this.currentDevice) {
      this.publishDeviceChanged();
    }
  }

  private publishDeviceChanged(): void {
    const sink = this.eventSink;

    if (sink === null) {
      return;
    }

    sink.onDeviceChanged({
      currentDevice: this.currentDevice,
      deviceName: this.getActiveDeviceName(),
    });
  }

  private publishActionSnapshot(): void {
    const sink = this.eventSink;

    if (sink === null) {
      return;
    }

    for (let index = 0; index < this.actionEntries.length; index += 1) {
      const entry = this.actionEntries[index];

      if (entry !== undefined) {
        this.publishAction(sink, entry);
      }
    }
  }

  private publishAction(sink: InputEventSink, entry: ActionRuntimeEntry): void {
    let otherPressed = false;
    let gamepadPressed = false;
    let otherHeld = false;
    let gamepadHeld = false;
    let otherReleased = false;
    let gamepadReleased = false;

    for (let index = 0; index < entry.bindings.length; index += 1) {
      const binding = entry.bindings[index];

      if (binding === undefined) {
        continue;
      }

      const isGamepad = isGamepadBinding(binding);

      if (this.bindingFlag(binding, 0)) {
        if (isGamepad) {
          gamepadPressed = true;
        } else {
          otherPressed = true;
        }
      }

      if (this.bindingFlag(binding, 1)) {
        if (isGamepad) {
          gamepadHeld = true;
        } else {
          otherHeld = true;
        }
      }

      if (this.bindingFlag(binding, 2)) {
        if (isGamepad) {
          gamepadReleased = true;
        } else {
          otherReleased = true;
        }
      }
    }

    const held = otherHeld || gamepadHeld;
    const preferGamepad = this.currentDevice === "gamepad";
    const touch = this.currentDevice === "touch";

    if (otherPressed || gamepadPressed) {
      const useGamepad = (preferGamepad && gamepadPressed) || !otherPressed;
      let payload = useGamepad
        ? entry.gamepadPressed
        : touch
          ? entry.touchPressed
          : entry.keyboardPressed;

      if (useGamepad) {
        // Gatilhos: o pressed carrega o valor analógico (borda rara; aloca
        // só quando fracionário, o caso digital reaproveita o payload).
        const value = this.maxValue(entry.bindings);

        if (value > 0 && value < 1) {
          payload = createActionPayload(entry.action, "pressed", value, "gamepad");
        }
      }

      sink.onAction(payload);
    } else if (held && this.emitHeld) {
      sink.onAction(
        (preferGamepad && gamepadHeld) || !otherHeld
          ? entry.gamepadHeld
          : touch
            ? entry.touchHeld
            : entry.keyboardHeld,
      );
    }

    // Toque mais curto que um frame: pressed E released no mesmo frame (G50).
    if (!held && (otherReleased || gamepadReleased)) {
      sink.onAction(
        (preferGamepad && gamepadReleased) || !otherReleased
          ? entry.gamepadReleased
          : touch
            ? entry.touchReleased
            : entry.keyboardReleased,
      );
    }
  }

  private installBindingMap(map: InputBindingMap): void {
    const entries: ActionRuntimeEntry[] = [];
    const axisHalves: CompiledBinding[] = [];
    const nextActions = new Map<string, ActionRuntimeEntry>();
    const nextAxes = new Map<string, AxisRuntimeEntry>();
    const boundCodes = new Set<string>();

    const compile = (code: string, label: string): CompiledBinding => {
      assertNonEmpty(code, label);
      const compiled = compileBinding(code);

      if (compiled.kind === BindingKind.GamepadAxisHalf) {
        axisHalves.push(compiled);
      } else if (compiled.kind === BindingKind.Key) {
        boundCodes.add(code);
      }

      return compiled;
    };

    for (const action of Object.keys(map.actions)) {
      assertNonEmpty(action, "action");
      const sourceBindings = map.actions[action] ?? [];
      const bindings: CompiledBinding[] = [];

      for (const binding of sourceBindings) {
        if (binding !== undefined) {
          bindings.push(compile(binding, `binding ${action}`));
        }
      }

      const entry: ActionRuntimeEntry = {
        action,
        bindings,
        keyboardPressed: createActionPayload(action, "pressed", 1, "keyboard_mouse"),
        keyboardHeld: createActionPayload(action, "held", 1, "keyboard_mouse"),
        keyboardReleased: createActionPayload(action, "released", 0, "keyboard_mouse"),
        gamepadPressed: createActionPayload(action, "pressed", 1, "gamepad"),
        gamepadHeld: createActionPayload(action, "held", 1, "gamepad"),
        gamepadReleased: createActionPayload(action, "released", 0, "gamepad"),
        touchPressed: createActionPayload(action, "pressed", 1, "touch"),
        touchHeld: createActionPayload(action, "held", 1, "touch"),
        touchReleased: createActionPayload(action, "released", 0, "touch"),
      };

      entries.push(entry);
      nextActions.set(action, entry);
    }

    for (const axisName of Object.keys(map.axes)) {
      assertNonEmpty(axisName, "axis");
      const axis = map.axes[axisName];

      if (axis === undefined) {
        continue;
      }

      const positive: CompiledBinding[] = [compile(axis.positive, `${axisName}.positive`)];
      const negative: CompiledBinding[] = [compile(axis.negative, `${axisName}.negative`)];
      const legacy = LEGACY_STICK_AXES[axisName];

      if (axis.positiveAlt === undefined && axis.negativeAlt === undefined && legacy !== undefined) {
        positive.push(compile(legacy[0], `${axisName}.positiveAlt`));
        negative.push(compile(legacy[1], `${axisName}.negativeAlt`));
      }

      for (const code of axis.positiveAlt ?? []) {
        positive.push(compile(code, `${axisName}.positiveAlt`));
      }

      for (const code of axis.negativeAlt ?? []) {
        negative.push(compile(code, `${axisName}.negativeAlt`));
      }

      nextAxes.set(axisName, { positive, negative });
    }

    this.actionsByName.clear();
    this.axesByName.clear();

    for (const [name, entry] of nextActions) {
      this.actionsByName.set(name, entry);
    }

    for (const [name, entry] of nextAxes) {
      this.axesByName.set(name, entry);
    }

    this.actionEntries = entries;
    this.axisHalfBindings = axisHalves;
    this.kmDriver.setBoundCodes(boundCodes);
  }
}
