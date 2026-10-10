# input — Input Manager
capability: game.input@1.0.0 | category: functional | engine plugin id: game.input
use (from src/projects/<jogo>/**):
  import { InputToken } from "../../tokens/input";
  // acesso: const api = ctx.caps.require(Token)  (declare o token em capabilities.consumes + permissions.capabilities)

## token src/tokens/input.ts
```ts
interface InputApi {
  readonly activeDevice: InputDeviceType;
  readonly isPointerLocked: boolean;
  update(): void; // Atualiza o estado interno do input manager (deve ser chamado 1x por frame no Game Loop).
  isActionPressed(action: string): boolean; // Retorna verdadeiro se a ação lógica foi pressionada exatamente no frame atual.
  isActionHeld(action: string): boolean; // Retorna verdadeiro se a ação lógica continua mantida pressionada.
  isActionReleased(action: string): boolean; // Retorna verdadeiro se a ação lógica foi liberada no frame atual.
  getAxis(axisName: string): number; // Retorna o valor de um eixo analógico normalizado entre -1.0 e +1.0.
  getMouseDelta(): Readonly<Vector2D>; // Retorna a variação vetorial do mouse no frame (Delta X, Delta Y) para rotação de câmera 3D.
  setBindingMap(map: InputBindingMap): void; // Define o mapa de vinculação de teclas/botões para ações lógicas.
  requestPointerLock(element?: HTMLElement): Promise<boolean>; // Solicita a trava do ponteiro do mouse na janela do Tauri para jogos 3D.
  exitPointerLock(): void; // Libera a trava do ponteiro do mouse.
}
capability InputToken = "game.input"@1.0.0 api InputApi
```
## contract src/contracts/input/types.ts
```ts
export type InputDeviceType = "keyboard_mouse" | "gamepad" | "touch";
export type InputActionState = "pressed" | "held" | "released";
interface Vector2D {
  x: number;
  y: number;
}
interface InputActionPayload {
  readonly action: string;
  readonly state: InputActionState;
  readonly value: number;
  readonly device: InputDeviceType;
}
event InputActionEvent = "game.input.action" payload InputActionPayload
interface InputDeviceChangedPayload {
  readonly currentDevice: InputDeviceType;
  readonly deviceName: string;
}
event InputDeviceChangedEvent = "game.input.device-changed" payload InputDeviceChangedPayload
interface AxisBinding {
  readonly positive: string;
  readonly negative: string;
}
interface InputBindingMap {
  readonly actions: Record<string, string[]>;
  readonly axes: Record<string, AxisBinding>;
}
```
## notas verificadas (comportamento)
- A engine bombeia `update()` do input por `requestAnimationFrame` (NÃO pelo tick). Por isso `isActionPressed/Released` lidos dentro de `game.loop.tick` podem perder ou duplicar a borda. Para ações de toque único (interagir, largar, pular) escute o evento `game.input.action` (`state === "pressed"`). Para contínuos (`getAxis`, `isActionHeld`) leia no tick.
- `setBindingMap(map)` SUBSTITUI o mapa inteiro: inclua todas as ações E os eixos `MoveForward`/`MoveRight` no seu mapa.
- Mapa padrão: ações `Jump`=Space/GamepadButton0, `Interact`=KeyE/GamepadButton2, `Attack`=Mouse0/GamepadButton1; eixos `MoveForward` = KeyW(+1)/KeyS(−1), `MoveRight` = KeyD(+1)/KeyA(−1). Valor = soma positivos − negativos (−1..1).
- Códigos: `KeyboardEvent.code` (`KeyW`, `Space`, `ShiftLeft`, `Tab`), mouse `Mouse0`/`Mouse1`/`Mouse2`, gamepad `GamepadButtonN`. O analógico do gamepad só alimenta eixos chamados exatamente `MoveForward` e `MoveRight`.
- LACUNA: não há roda do mouse. Para zoom, registre `wheel` no DOM dentro de um adapter do jogo (com `{ passive: true }`) e remova no dispose.
- Teardown: devolva o dispose de qualquer listener registrado.
- `game.input.action` sai A CADA FRAME para ações mantidas (`state:"held"`): filtre `pressed`/`released`. Toque curtíssimo emite `pressed` sem `released` (G50): "segurando" sempre por `isActionHeld` no tick.
- Teclas/cliques são capturados mesmo com um campo de texto em foco (G51): ignore ações enquanto a UI do jogo tiver foco; `preventDefault` de Space/Tab num adapter. `getMouseDelta()` leia no render (G52).
