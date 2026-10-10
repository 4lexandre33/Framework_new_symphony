// Ações de toque único: o input é bombeado por requestAnimationFrame, não pelo tick.
// Use o evento game.input.action para bordas; eixos/held leia no tick.
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
  },
  axes: {
    MoveForward: { positive: "KeyW", negative: "KeyS" },
    MoveRight: { positive: "KeyD", negative: "KeyA" },
  },
};

export function bindEdges(ctx: PluginContext, onPressed: (action: string) => void): () => void {
  return ctx.events.on<"game.input.action", InputActionPayload>(InputActionEvent.type, (env): void => {
    if (env.payload.state === "pressed") onPressed(env.payload.action);
  });
}

/** Leitura contínua no tick (sem alocar: escreve no objeto recebido). */
export function readMove(input: InputApi, out: { x: number; z: number; sprint: boolean }): void {
  out.x = input.getAxis("MoveRight");
  out.z = input.getAxis("MoveForward");
  out.sprint = input.isActionHeld("Sprint");
}
