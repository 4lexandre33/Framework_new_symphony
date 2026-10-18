// Input por AÇÕES lógicas (não por teclas). Consulte no tick com as variantes *InTick.
// Mapa padrão: ações Jump(Space), Interact(KeyE), Attack(Mouse0); eixos MoveForward(W/S), MoveRight(D/A), LookRight/LookUp (analógico direito).
// Códigos = KeyboardEvent.code ("KeyW", "Space"); mouse "Mouse0..2"; roda "WheelUp/WheelDown"; gamepad "GamepadButtonN"/"GamepadAxisN+".
// setBindingMap SUBSTITUI o mapa inteiro.
import type { InputBindingMap } from "../../../contracts/input/types";
import type { InputApi } from "../../../tokens/input";

const BINDINGS: InputBindingMap = {
  actions: { jump: ["Space", "GamepadButton0"], fire: ["Mouse0", "GamepadButton7"] },
  axes: {
    moveX: { positive: "KeyD", negative: "KeyA", positiveAlt: ["GamepadAxis0+"], negativeAlt: ["GamepadAxis0-"] },
    moveY: { positive: "KeyW", negative: "KeyS", positiveAlt: ["GamepadAxis1-"], negativeAlt: ["GamepadAxis1+"] },
  },
};

export function setupInput(input: InputApi): void {
  input.setBindingMap(BINDINGS);
}

/** Chame dentro de game.loop.tick. Escreve em `out` (sem alocar). */
export function pollInput(input: InputApi, out: { jump: boolean; moveX: number; moveY: number }): void {
  out.jump = input.isActionPressedInTick("jump"); // borda vista uma vez por tick
  out.moveX = input.getAxis("moveX");
  out.moveY = input.getAxis("moveY");
}
// Mouse 3D: await input.requestPointerLock(); no tick some input.getTickMouseDelta() (no render: getMouseDelta()).
