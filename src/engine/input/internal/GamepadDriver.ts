const DEFAULT_DEADZONE = 0.15;
const BUTTON_DOWN_THRESHOLD = 0.5;
const DEVICE_ACTIVITY_AXIS_THRESHOLD = 0.1;
const NO_GAMEPAD_NAME = "Nenhum Gamepad Conectado";

/** Número máximo de gamepads simultâneos acompanhados (slots de `Gamepad.index`). */
export const MAX_GAMEPADS = 8;

/** Índice "qualquer gamepad" nas consultas agregadas. */
export const ANY_GAMEPAD = -1;

function clampUnit(value: number): number {
  if (value > 1) {
    return 1;
  }

  if (value < -1) {
    return -1;
  }

  return value;
}

export function sanitizeDeadzone(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError(
      "deadzone precisa ser finita e estar em 0 <= deadzone < 1.",
    );
  }

  return value;
}

export interface GamepadConnectionListener {
  (index: number, id: string, connected: boolean): void;
}

/**
 * Estado de um slot de gamepad. Todos os buffers são reaproveitados entre
 * frames; só crescem quando o dispositivo reporta mais botões/eixos.
 */
class GamepadSlot {
  public connected = false;
  public id = NO_GAMEPAD_NAME;
  public activity = false;
  public seen = false;
  public pendingDisconnect = false;
  public lastActivityFrame = -1;

  public buttonsDown = new Uint8Array(0);
  public buttonsPressedFrame = new Uint8Array(0);
  public buttonsReleasedFrame = new Uint8Array(0);
  public buttonsPressedTickPending = new Uint8Array(0);
  public buttonsReleasedTickPending = new Uint8Array(0);
  public buttonsPressedTick = new Uint8Array(0);
  public buttonsReleasedTick = new Uint8Array(0);
  public buttonValues = new Float32Array(0);
  public axesRaw = new Float32Array(0);
  public axesFrame = new Float32Array(0);

  public ensureButtons(required: number): void {
    if (required <= this.buttonsDown.length) {
      return;
    }

    this.buttonsDown = grow8(this.buttonsDown, required);
    this.buttonsPressedFrame = grow8(this.buttonsPressedFrame, required);
    this.buttonsReleasedFrame = grow8(this.buttonsReleasedFrame, required);
    this.buttonsPressedTickPending = grow8(this.buttonsPressedTickPending, required);
    this.buttonsReleasedTickPending = grow8(this.buttonsReleasedTickPending, required);
    this.buttonsPressedTick = grow8(this.buttonsPressedTick, required);
    this.buttonsReleasedTick = grow8(this.buttonsReleasedTick, required);
    const values = new Float32Array(required);
    values.set(this.buttonValues);
    this.buttonValues = values;
  }

  public ensureAxes(required: number): void {
    if (required === this.axesFrame.length) {
      return;
    }

    this.axesFrame = new Float32Array(required);
    this.axesRaw = new Float32Array(required);
  }

  public resetSnapshot(): void {
    this.buttonsDown.fill(0);
    this.buttonsPressedFrame.fill(0);
    this.buttonsReleasedFrame.fill(0);
    this.buttonValues.fill(0);
    this.axesFrame.fill(0);
    this.axesRaw.fill(0);
  }

  public resetTick(): void {
    this.buttonsPressedTickPending.fill(0);
    this.buttonsReleasedTickPending.fill(0);
    this.buttonsPressedTick.fill(0);
    this.buttonsReleasedTick.fill(0);
  }
}

function grow8(source: Uint8Array, required: number): Uint8Array {
  const next = new Uint8Array(required);
  next.set(source);
  return next;
}

function inRange(array: ArrayLike<number>, index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < array.length;
}

/**
 * Driver de gamepads (Gamepad API). Acompanha até {@link MAX_GAMEPADS}
 * controles ao mesmo tempo, com botões analógicos (gatilhos), todos os eixos
 * (analógico esquerdo e direito), zona morta configurável e bordas
 * por frame e por tick.
 *
 * As consultas sem `gamepadIndex` (ou com {@link ANY_GAMEPAD}) agregam
 * todos os controles conectados (OR para botões, maior magnitude para eixos).
 */
export class GamepadDriver {
  private deadzone: number;

  private readonly slots: GamepadSlot[] = [];

  private isBound = false;
  private disposed = false;
  private meaningfulInputThisFrame = false;
  private frameCounter = 0;
  private lastActiveSlot = -1;
  private connectionListener: GamepadConnectionListener | null = null;

  public constructor(deadzone: number = DEFAULT_DEADZONE) {
    this.deadzone = sanitizeDeadzone(deadzone);

    for (let index = 0; index < MAX_GAMEPADS; index += 1) {
      this.slots.push(new GamepadSlot());
    }

    this.handleGamepadConnected = this.handleGamepadConnected.bind(this);
    this.handleGamepadDisconnected = this.handleGamepadDisconnected.bind(this);
  }

  public attach(): void {
    if (this.disposed || this.isBound) {
      return;
    }

    window.addEventListener("gamepadconnected", this.handleGamepadConnected);
    window.addEventListener("gamepaddisconnected", this.handleGamepadDisconnected);
    this.isBound = true;
  }

  public detach(): void {
    if (!this.isBound) {
      return;
    }

    window.removeEventListener("gamepadconnected", this.handleGamepadConnected);
    window.removeEventListener("gamepaddisconnected", this.handleGamepadDisconnected);
    this.resetAllState();
    this.isBound = false;
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.detach();
    this.connectionListener = null;
    this.disposed = true;
  }

  public setConnectionListener(listener: GamepadConnectionListener | null): void {
    this.connectionListener = listener;
  }

  public get deadZone(): number {
    return this.deadzone;
  }

  /** Altera a zona morta dos eixos (0 <= v < 1). Lança RangeError se inválida. */
  public setDeadzone(value: number): void {
    this.deadzone = sanitizeDeadzone(value);

    for (let slotIndex = 0; slotIndex < this.slots.length; slotIndex += 1) {
      const slot = this.slots[slotIndex];

      if (slot === undefined) {
        continue;
      }

      for (let axis = 0; axis < slot.axesFrame.length; axis += 1) {
        slot.axesFrame[axis] = this.applyDeadzone(slot.axesRaw[axis] ?? 0);
      }
    }
  }

  public update(): void {
    if (this.disposed) {
      return;
    }

    this.frameCounter += 1;
    this.meaningfulInputThisFrame = false;
    const gamepads = this.readGamepads();

    for (let slotIndex = 0; slotIndex < this.slots.length; slotIndex += 1) {
      const slot = this.slots[slotIndex];

      if (slot !== undefined) {
        slot.buttonsPressedFrame.fill(0);
        slot.buttonsReleasedFrame.fill(0);
        slot.activity = false;
        slot.seen = false;
      }
    }

    const count = gamepads === null ? 0 : gamepads.length;

    for (let position = 0; position < count; position += 1) {
      const gamepad = gamepads === null ? null : gamepads[position] ?? null;

      if (gamepad === null || !gamepad.connected) {
        continue;
      }

      const slotIndex = Number.isInteger(gamepad.index) ? gamepad.index : position;
      const slot = this.slot(slotIndex);

      if (slot === null || slot.pendingDisconnect) {
        continue;
      }

      slot.seen = true;

      if (!slot.connected) {
        slot.connected = true;
        slot.id = gamepad.id;
        slot.resetSnapshot();
        slot.resetTick();
        this.notifyConnection(slotIndex, gamepad.id, true);
      }

      this.readSlot(slot, gamepad);

      if (slot.activity) {
        this.meaningfulInputThisFrame = true;
        slot.lastActivityFrame = this.frameCounter;
        this.lastActiveSlot = slotIndex;
      }
    }

    for (let slotIndex = 0; slotIndex < this.slots.length; slotIndex += 1) {
      const slot = this.slots[slotIndex];

      if (slot === undefined) {
        continue;
      }

      if (!slot.seen && slot.connected) {
        this.disconnectSlot(slot, slotIndex);
      }

      slot.pendingDisconnect = false;
    }

    if (this.lastActiveSlot >= 0 && this.slots[this.lastActiveSlot]?.connected !== true) {
      this.lastActiveSlot = this.firstConnectedSlot();
    }
  }

  /**
   * Fronteira de tick fixo: publica as bordas acumuladas desde o tick
   * anterior (vistas por `isButtonPressedInTick`) e zera o acumulador.
   */
  public advanceTick(): void {
    for (let slotIndex = 0; slotIndex < this.slots.length; slotIndex += 1) {
      const slot = this.slots[slotIndex];

      if (slot === undefined) {
        continue;
      }

      slot.buttonsPressedTick.set(slot.buttonsPressedTickPending);
      slot.buttonsReleasedTick.set(slot.buttonsReleasedTickPending);
      slot.buttonsPressedTickPending.fill(0);
      slot.buttonsReleasedTickPending.fill(0);
    }
  }

  /** Descarta bordas ainda não publicadas para o tick (ex.: durante pausa). */
  public discardPendingTickEdges(): void {
    for (let slotIndex = 0; slotIndex < this.slots.length; slotIndex += 1) {
      const slot = this.slots[slotIndex];

      if (slot === undefined) {
        continue;
      }

      slot.buttonsPressedTickPending.fill(0);
      slot.buttonsReleasedTickPending.fill(0);
    }
  }

  public get isConnected(): boolean {
    return this.firstConnectedSlot() >= 0;
  }

  public get connectedCount(): number {
    let count = 0;

    for (let slotIndex = 0; slotIndex < this.slots.length; slotIndex += 1) {
      if (this.slots[slotIndex]?.connected === true) {
        count += 1;
      }
    }

    return count;
  }

  public isGamepadConnected(gamepadIndex: number): boolean {
    return this.slot(gamepadIndex)?.connected === true;
  }

  public get hasActivityThisFrame(): boolean {
    return this.meaningfulInputThisFrame;
  }

  /** Nome do gamepad usado mais recentemente (ou do slot pedido). */
  public getGamepadName(gamepadIndex: number = ANY_GAMEPAD): string {
    if (gamepadIndex !== ANY_GAMEPAD) {
      const slot = this.slot(gamepadIndex);
      return slot !== null && slot.connected ? slot.id : NO_GAMEPAD_NAME;
    }

    const active = this.slots[this.lastActiveSlot];

    if (active !== undefined && active.connected) {
      return active.id;
    }

    const first = this.slots[this.firstConnectedSlot()];
    return first !== undefined ? first.id : NO_GAMEPAD_NAME;
  }

  /** Índice do gamepad usado mais recentemente (-1 se nenhum). */
  public get lastActiveGamepadIndex(): number {
    return this.lastActiveSlot;
  }

  public isButtonDown(buttonIndex: number, gamepadIndex: number = ANY_GAMEPAD): boolean {
    return this.anyFlag(buttonIndex, gamepadIndex, 0);
  }

  public isButtonPressed(buttonIndex: number, gamepadIndex: number = ANY_GAMEPAD): boolean {
    return this.anyFlag(buttonIndex, gamepadIndex, 1);
  }

  public isButtonReleased(buttonIndex: number, gamepadIndex: number = ANY_GAMEPAD): boolean {
    return this.anyFlag(buttonIndex, gamepadIndex, 2);
  }

  public isButtonPressedInTick(buttonIndex: number, gamepadIndex: number = ANY_GAMEPAD): boolean {
    return this.anyFlag(buttonIndex, gamepadIndex, 3);
  }

  public isButtonReleasedInTick(buttonIndex: number, gamepadIndex: number = ANY_GAMEPAD): boolean {
    return this.anyFlag(buttonIndex, gamepadIndex, 4);
  }

  /** Valor analógico do botão (0..1; gatilhos 6/7 no mapeamento standard). */
  public getButtonValue(buttonIndex: number, gamepadIndex: number = ANY_GAMEPAD): number {
    if (gamepadIndex !== ANY_GAMEPAD) {
      const slot = this.slot(gamepadIndex);

      if (slot === null || !slot.connected || !inRange(slot.buttonValues, buttonIndex)) {
        return 0;
      }

      return slot.buttonValues[buttonIndex] ?? 0;
    }

    let best = 0;

    for (let slotIndex = 0; slotIndex < this.slots.length; slotIndex += 1) {
      const slot = this.slots[slotIndex];

      if (slot === undefined || !slot.connected || !inRange(slot.buttonValues, buttonIndex)) {
        continue;
      }

      const value = slot.buttonValues[buttonIndex] ?? 0;

      if (value > best) {
        best = value;
      }
    }

    return best;
  }

  /** Eixo com zona morta aplicada (-1..1). Sem índice: maior magnitude entre os controles. */
  public getAxisValue(axisIndex: number, gamepadIndex: number = ANY_GAMEPAD): number {
    if (gamepadIndex !== ANY_GAMEPAD) {
      const slot = this.slot(gamepadIndex);

      if (slot === null || !slot.connected || !inRange(slot.axesFrame, axisIndex)) {
        return 0;
      }

      return slot.axesFrame[axisIndex] ?? 0;
    }

    let best = 0;

    for (let slotIndex = 0; slotIndex < this.slots.length; slotIndex += 1) {
      const slot = this.slots[slotIndex];

      if (slot === undefined || !slot.connected || !inRange(slot.axesFrame, axisIndex)) {
        continue;
      }

      const value = slot.axesFrame[axisIndex] ?? 0;

      if (Math.abs(value) > Math.abs(best)) {
        best = value;
      }
    }

    return best;
  }

  /** Preenche `target` com {index, id} de cada gamepad conectado. */
  public collectConnected(
    target: Array<{ index: number; id: string; buttons: number; axes: number }>,
  ): void {
    target.length = 0;

    for (let slotIndex = 0; slotIndex < this.slots.length; slotIndex += 1) {
      const slot = this.slots[slotIndex];

      if (slot !== undefined && slot.connected) {
        target.push({
          index: slotIndex,
          id: slot.id,
          buttons: slot.buttonsDown.length,
          axes: slot.axesFrame.length,
        });
      }
    }
  }

  private anyFlag(buttonIndex: number, gamepadIndex: number, kind: number): boolean {
    if (gamepadIndex !== ANY_GAMEPAD) {
      const slot = this.slot(gamepadIndex);
      return slot !== null && this.slotFlag(slot, buttonIndex, kind);
    }

    for (let slotIndex = 0; slotIndex < this.slots.length; slotIndex += 1) {
      const slot = this.slots[slotIndex];

      if (slot !== undefined && this.slotFlag(slot, buttonIndex, kind)) {
        return true;
      }
    }

    return false;
  }

  private slotFlag(slot: GamepadSlot, buttonIndex: number, kind: number): boolean {
    const array =
      kind === 0
        ? slot.buttonsDown
        : kind === 1
          ? slot.buttonsPressedFrame
          : kind === 2
            ? slot.buttonsReleasedFrame
            : kind === 3
              ? slot.buttonsPressedTick
              : slot.buttonsReleasedTick;

    return inRange(array, buttonIndex) && array[buttonIndex] === 1;
  }

  private slot(gamepadIndex: number): GamepadSlot | null {
    if (!Number.isInteger(gamepadIndex) || gamepadIndex < 0 || gamepadIndex >= this.slots.length) {
      return null;
    }

    return this.slots[gamepadIndex] ?? null;
  }

  private firstConnectedSlot(): number {
    for (let slotIndex = 0; slotIndex < this.slots.length; slotIndex += 1) {
      if (this.slots[slotIndex]?.connected === true) {
        return slotIndex;
      }
    }

    return -1;
  }

  private readSlot(slot: GamepadSlot, gamepad: Gamepad): void {
    slot.ensureButtons(gamepad.buttons.length);
    slot.ensureAxes(gamepad.axes.length);

    for (let index = 0; index < slot.buttonsDown.length; index += 1) {
      const button = gamepad.buttons[index];
      const rawValue =
        button === undefined
          ? 0
          : Number.isFinite(button.value)
            ? button.value
            : button.pressed
              ? 1
              : 0;
      const value = rawValue < 0 ? 0 : rawValue > 1 ? 1 : rawValue;
      const nextDown =
        button !== undefined && (button.pressed || value >= BUTTON_DOWN_THRESHOLD);
      const wasDown = slot.buttonsDown[index] === 1;

      slot.buttonValues[index] = nextDown && value === 0 ? 1 : value;
      slot.buttonsPressedFrame[index] = nextDown && !wasDown ? 1 : 0;
      slot.buttonsReleasedFrame[index] = !nextDown && wasDown ? 1 : 0;
      slot.buttonsDown[index] = nextDown ? 1 : 0;

      if (nextDown && !wasDown) {
        slot.buttonsPressedTickPending[index] = 1;
      }

      if (!nextDown && wasDown) {
        slot.buttonsReleasedTickPending[index] = 1;
      }

      if (nextDown || wasDown) {
        slot.activity = true;
      }
    }

    for (let index = 0; index < slot.axesFrame.length; index += 1) {
      const raw = gamepad.axes[index] ?? 0;
      slot.axesRaw[index] = Number.isFinite(raw) ? clampUnit(raw) : 0;
      const value = this.applyDeadzone(raw);
      slot.axesFrame[index] = value;

      if (Math.abs(value) > DEVICE_ACTIVITY_AXIS_THRESHOLD) {
        slot.activity = true;
      }
    }
  }

  private disconnectSlot(slot: GamepadSlot, slotIndex: number): void {
    for (let index = 0; index < slot.buttonsDown.length; index += 1) {
      if (slot.buttonsDown[index] === 1) {
        slot.buttonsReleasedFrame[index] = 1;
        slot.buttonsReleasedTickPending[index] = 1;
        this.meaningfulInputThisFrame = true;
      }

      slot.buttonsDown[index] = 0;
    }

    slot.buttonValues.fill(0);
    slot.axesFrame.fill(0);
    slot.axesRaw.fill(0);
    slot.connected = false;
    const id = slot.id;
    slot.id = NO_GAMEPAD_NAME;
    this.notifyConnection(slotIndex, id, false);
  }

  private notifyConnection(index: number, id: string, connected: boolean): void {
    const listener = this.connectionListener;

    if (listener !== null) {
      listener(index, id, connected);
    }
  }

  private applyDeadzone(rawValue: number): number {
    if (!Number.isFinite(rawValue)) {
      return 0;
    }

    const clamped = clampUnit(rawValue);
    const magnitude = Math.abs(clamped);

    if (magnitude <= this.deadzone) {
      return 0;
    }

    const normalized = (magnitude - this.deadzone) / (1 - this.deadzone);
    return clamped < 0 ? -normalized : normalized;
  }

  private readGamepads(): ArrayLike<Gamepad | null> | null {
    if (typeof navigator === "undefined") {
      return null;
    }

    const read = navigator.getGamepads;

    if (typeof read !== "function") {
      return null;
    }

    try {
      return read.call(navigator) as unknown as ArrayLike<Gamepad | null>;
    } catch {
      return null;
    }
  }

  private resetAllState(): void {
    for (let slotIndex = 0; slotIndex < this.slots.length; slotIndex += 1) {
      const slot = this.slots[slotIndex];

      if (slot === undefined) {
        continue;
      }

      slot.resetSnapshot();
      slot.resetTick();
      slot.connected = false;
      slot.id = NO_GAMEPAD_NAME;
      slot.activity = false;
    }

    this.lastActiveSlot = -1;
    this.meaningfulInputThisFrame = false;
  }

  private handleGamepadConnected(event: GamepadEvent): void {
    // O estado real é lido por polling em update(); o evento apenas
    // garante que o próximo frame veja o controle (Chrome só expõe
    // gamepads após o primeiro input/conexão).
    void event;
  }

  private handleGamepadDisconnected(event: GamepadEvent): void {
    // Marca para o próximo update(): a borda "released" dos botões
    // mantidos sai no frame seguinte (não se perde fora de um frame).
    const slot = this.slot(event.gamepad.index);

    if (slot !== null && slot.connected) {
      slot.pendingDisconnect = true;
    }
  }
}
