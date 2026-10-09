// Input por AÇÕES lógicas (não por teclas). Consulte no tick.
// Já existe um mapa padrão: ações Jump(Space), Interact(KeyE), Attack(Mouse0); eixos MoveForward(KeyW/KeyS), MoveRight(KeyD/KeyA).
// Códigos de tecla = KeyboardEvent.code ("KeyW", "Space"); mouse = "Mouse0..2"; gamepad = "GamepadButton0..". setBindingMap SUBSTITUI o mapa.
import type { InputBindingMap } from "../../../contracts/input/types";
import type { InputApi } from "../../../tokens/input";

const BINDINGS: InputBindingMap = {
  actions: { jump: ["Space"], fire: ["Mouse0"] },
  axes: { moveX: { positive: "KeyD", negative: "KeyA" }, moveY: { positive: "KeyW", negative: "KeyS" } },
};

export function setupInput(input: InputApi): void {
  input.setBindingMap(BINDINGS);
}

export function pollInput(input: InputApi): { jump: boolean; moveX: number; moveY: number } {
  return { jump: input.isActionPressed("jump"), moveX: input.getAxis("moveX"), moveY: input.getAxis("moveY") };
}
// Mouse 3D: await input.requestPointerLock(); depois input.getMouseDelta().
