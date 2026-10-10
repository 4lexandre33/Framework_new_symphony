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
  update(): void; // NÃO chame em jogos: com o plugin `game.input` ativo a engine já avança o frame de input por requestAnimationF…
  readonly isTickSynchronized: boolean; // true depois que o primeiro `game.loop.tick` foi observado: as consultas `*InTick`/`getTick*` passam a usar o …
  isActionPressed(action: string): boolean; // Retorna verdadeiro se a ação lógica foi pressionada exatamente no frame atual (frame de input/render).
  isActionHeld(action: string): boolean; // Retorna verdadeiro se a ação lógica continua mantida pressionada.
  isActionReleased(action: string): boolean; // Retorna verdadeiro se a ação lógica foi liberada no frame atual.
  isActionPressedInTick(action: string): boolean; // Borda de pressão vista UMA vez por tick fixo: verdadeiro no primeiro `game.loop.tick` após a pressão, mesmo q…
  isActionReleasedInTick(action: string): boolean; // Borda de soltura vista uma vez por tick fixo (ver `isActionPressedInTick`).
  getActionValue(action: string): number; // Valor analógico atual da ação (0..1): gatilhos/meio-eixos do gamepad dão frações; teclas e botões digitais dã…
  getAxis(axisName: string): number; // Retorna o valor de um eixo analógico normalizado entre -1.0 e +1.0.
  getMouseDelta(): Readonly<Vector2D>; // Retorna a variação vetorial do mouse no frame (Delta X, Delta Y) para rotação de câmera 3D.
  getTickMouseDelta(): Readonly<Vector2D>; // Delta do mouse acumulado desde o tick anterior (leia em `game.loop.tick`).
  getWheelDelta(): Readonly<Vector2D>; // Roda do mouse no frame, em pixels (y > 0 = para baixo/afastar).
  getTickWheelDelta(): Readonly<Vector2D>; // Roda acumulada desde o tick anterior (leia em `game.loop.tick`).
  getPointerPosition(): Readonly<Vector2D>; // Última posição do ponteiro (clientX/clientY).
  getTouchCount(): number; // Número de toques ativos na tela.
  getTouchPosition(index: number): Readonly<Vector2D> | null; // Posição (clientX/clientY) do i-ésimo toque ativo, ou null.
  getConnectedGamepads(): readonly InputGamepadInfo[]; // Gamepads conectados (novo array a cada chamada; não use por frame).
  getGamepadAxis(axisIndex: number, gamepadIndex?: number): number; // Eixo do gamepad com zona morta (−1..1).
  getGamepadButtonValue(buttonIndex: number, gamepadIndex?: number): number; // Valor analógico do botão do gamepad (0..1; gatilhos = 6/7 no mapeamento standard).
  readonly gamepadDeadZone: number; // Zona morta atual dos eixos do gamepad.
  setGamepadDeadZone(deadZone: number): boolean; // Define a zona morta (0 <= v < 1).
  setFilterOptions(options: InputFilterOptions): void; // Ajusta os filtros de foco/alvo do DOM (G51).
  setActionEventOptions(options: InputActionEventOptions): void; // Ajusta a emissão de `game.input.action` (ex.: `{ emitHeld: false }`).
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
interface AxisBinding { // Eixo lógico: valor = (maior valor entre os códigos positivos) − (maior valor entre os negativos), limitado a …
  readonly positive: string;
  readonly negative: string;
  readonly positiveAlt?: readonly string[]; // Códigos extras do lado positivo (ex.: `["GamepadButton12", "GamepadAxis1-"]`).
  readonly negativeAlt?: readonly string[]; // Códigos extras do lado negativo.
}
interface InputBindingMap {
  readonly actions: Record<string, string[]>;
  readonly axes: Record<string, AxisBinding>;
}
export type PointerLockChangeReason = /** a trava foi obtida */ | "acquired" /** liberada por `exitPointerLock()` */ | "released" /** perdida sem pedido do jogo (ESC do navegador, troca de janela) */ | "lost" /** o navegador recusou o pedido */ | "error";
interface PointerLockChangedPayload {
  readonly locked: boolean;
  readonly reason: PointerLockChangeReason;
}
event PointerLockChangedEvent = "game.input.pointer-lock-changed" payload PointerLockChangedPayload
interface GamepadConnectionPayload {
  readonly index: number; // `Gamepad.index` (use em `Gamepad<index>Button<n>` e nas consultas por controle).
  readonly id: string;
  readonly connected: boolean;
}
event GamepadConnectionEvent = "game.input.gamepad-connection" payload GamepadConnectionPayload
interface InputGamepadInfo {
  readonly index: number;
  readonly id: string;
  readonly buttons: number;
  readonly axes: number;
}
interface InputFilterOptions {
  readonly ignoreEditableTargets?: boolean; // Ignora teclas com foco em input/textarea/select/contenteditable/`[data-input-ignore]` (padrão true).
  readonly ignoreInteractiveMouseTargets?: boolean; // Ignora cliques e roda sobre button/a/input/label/`[data-input-ignore]`, exceto com pointer lock (padrão true).
  readonly preventDefaultForBoundKeys?: boolean; // `preventDefault` nas teclas presentes no mapa de binding (sem Ctrl/Alt/Meta): Space não rola, Tab não tira o …
}
interface InputActionEventOptions {
  readonly emitHeld?: boolean; // Emitir `state: "held"` a cada frame enquanto a ação está mantida (padrão true, compatível).
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
