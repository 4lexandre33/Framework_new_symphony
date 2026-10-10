import { defineEvent } from "@core";

export type InputDeviceType = "keyboard_mouse" | "gamepad" | "touch";

export type InputActionState = "pressed" | "held" | "released";

export interface Vector2D {
  x: number;
  y: number;
}

export interface InputActionPayload {
  readonly action: string;
  readonly state: InputActionState;
  readonly value: number;
  readonly device: InputDeviceType;
}

export const InputActionEvent = defineEvent<
  "game.input.action",
  InputActionPayload
>("game.input.action");

export interface InputDeviceChangedPayload {
  readonly currentDevice: InputDeviceType;
  readonly deviceName: string;
}

export const InputDeviceChangedEvent = defineEvent<
  "game.input.device-changed",
  InputDeviceChangedPayload
>("game.input.device-changed");

/**
 * Eixo lógico: valor = (maior valor entre os códigos positivos) − (maior
 * valor entre os negativos), limitado a −1..1.
 *
 * Códigos aceitos (em `positive`/`negative`/`*Alt` e nas ações):
 * - teclado: `KeyboardEvent.code` (`KeyW`, `Space`, `ArrowUp`...);
 * - mouse: `Mouse0`..`MouseN`; roda: `WheelUp`/`WheelDown`/`WheelLeft`/`WheelRight`
 *   (borda instantânea); toque: `Touch` (algum dedo na tela);
 * - gamepad (qualquer controle): `GamepadButtonN` (valor analógico 0..1, ex.:
 *   gatilhos 6/7, d-pad 12..15) e meio-eixo `GamepadAxisN+` / `GamepadAxisN-`
 *   (0..1, zona morta aplicada; analógico esquerdo = eixos 0/1, direito = 2/3);
 * - gamepad específico (índice `Gamepad.index`): `Gamepad1Button0`, `Gamepad1Axis2+`.
 */
export interface AxisBinding {
  readonly positive: string;
  readonly negative: string;
  /** Códigos extras do lado positivo (ex.: `["GamepadButton12", "GamepadAxis1-"]`). */
  readonly positiveAlt?: readonly string[];
  /** Códigos extras do lado negativo. */
  readonly negativeAlt?: readonly string[];
}

export interface InputBindingMap {
  readonly actions: Record<string, string[]>;
  readonly axes: Record<string, AxisBinding>;
}

export type PointerLockChangeReason =
  /** a trava foi obtida */
  | "acquired"
  /** liberada por `exitPointerLock()` */
  | "released"
  /** perdida sem pedido do jogo (ESC do navegador, troca de janela) */
  | "lost"
  /** o navegador recusou o pedido */
  | "error";

export interface PointerLockChangedPayload {
  readonly locked: boolean;
  readonly reason: PointerLockChangeReason;
}

export const PointerLockChangedEvent = defineEvent<
  "game.input.pointer-lock-changed",
  PointerLockChangedPayload
>("game.input.pointer-lock-changed");

export interface GamepadConnectionPayload {
  /** `Gamepad.index` (use em `Gamepad<index>Button<n>` e nas consultas por controle). */
  readonly index: number;
  readonly id: string;
  readonly connected: boolean;
}

export const GamepadConnectionEvent = defineEvent<
  "game.input.gamepad-connection",
  GamepadConnectionPayload
>("game.input.gamepad-connection");

export interface InputGamepadInfo {
  readonly index: number;
  readonly id: string;
  readonly buttons: number;
  readonly axes: number;
}

export interface InputFilterOptions {
  /** Ignora teclas com foco em input/textarea/select/contenteditable/`[data-input-ignore]` (padrão true). */
  readonly ignoreEditableTargets?: boolean;
  /** Ignora cliques e roda sobre button/a/input/label/`[data-input-ignore]`, exceto com pointer lock (padrão true). */
  readonly ignoreInteractiveMouseTargets?: boolean;
  /** `preventDefault` nas teclas presentes no mapa de binding (sem Ctrl/Alt/Meta): Space não rola, Tab não tira o foco (padrão true). */
  readonly preventDefaultForBoundKeys?: boolean;
}

export interface InputActionEventOptions {
  /** Emitir `state: "held"` a cada frame enquanto a ação está mantida (padrão true, compatível). */
  readonly emitHeld?: boolean;
}