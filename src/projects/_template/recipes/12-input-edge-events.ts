// Ações de toque único: leia as bordas NO TICK com isActionPressedInTick (vista uma vez por tick,
// mesmo com vários frames por tick ou toques mais curtos que um tick).
// Exceção: com o jogo PAUSADO não há tick — trate "continuar"/menus pelo evento game.input.action.
import type { PluginContext } from "@core";
import { InputActionEvent } from "../../../contracts/input/types";
import type { InputActionPayload, InputBindingMap } from "../../../contracts/input/types";
import type { InputApi } from "../../../tokens/input";

// setBindingMap SUBSTITUI tudo: inclua os eixos MoveForward/MoveRight.
export const BINDINGS: InputBindingMap = {
  actions: {
    Interact: ["KeyE", "GamepadButton2"],
    Jump: ["Space", "GamepadButton0"],
    Sprint: ["ShiftLeft", "GamepadButton4"],
    UseTool: ["Mouse0", "GamepadButton1"],
    Drop: ["KeyG", "GamepadButton3"],
    Pause: ["Escape", "GamepadButton9"], // a UI da engine não captura ESC
  },
  axes: {
    MoveForward: { positive: "KeyW", negative: "KeyS", positiveAlt: ["GamepadAxis1-"], negativeAlt: ["GamepadAxis1+"] },
    MoveRight: { positive: "KeyD", negative: "KeyA", positiveAlt: ["GamepadAxis0+"], negativeAlt: ["GamepadAxis0-"] },
  },
};

export interface TickInput {
  x: number;
  z: number;
  sprint: boolean;
  interactPressed: boolean;
  interactReleased: boolean;
  jump: boolean;
  useTool: boolean;
  drop: boolean;
}

/** Chame dentro de game.loop.tick. Escreve em `out` (sem alocar). */
export function readTick(input: InputApi, out: TickInput): void {
  out.x = input.getAxis("MoveRight");
  out.z = input.getAxis("MoveForward");
  out.sprint = input.isActionHeld("Sprint");
  out.interactPressed = input.isActionPressedInTick("Interact");
  out.interactReleased = input.isActionReleasedInTick("Interact");
  out.jump = input.isActionPressedInTick("Jump");
  out.useTool = input.isActionPressedInTick("UseTool");
  out.drop = input.isActionPressedInTick("Drop");
}

/** Pausa/menus: funciona com o loop pausado. Filtre `pressed` (o evento também sai com "held" a cada frame). */
export function onPausePressed(ctx: PluginContext, toggle: () => void): () => void {
  return ctx.events.on<"game.input.action", InputActionPayload>(InputActionEvent.type, (env): void => {
    if (env.payload.action === "Pause" && env.payload.state === "pressed") toggle();
  });
}
