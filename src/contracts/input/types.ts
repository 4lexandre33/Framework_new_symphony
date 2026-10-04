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

export interface AxisBinding {
  readonly positive: string;
  readonly negative: string;
}

export interface InputBindingMap {
  readonly actions: Record<string, string[]>;
  readonly axes: Record<string, AxisBinding>;
}