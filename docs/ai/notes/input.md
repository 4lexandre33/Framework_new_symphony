## notas verificadas (comportamento)
- A engine bombeia o input por `requestAnimationFrame`. NÃO chame `update()`.
- No `game.loop.tick`: bordas com `isActionPressedInTick`/`isActionReleasedInTick` (vistas uma vez por tick, inclusive toques mais curtos que um tick); contínuos com `getAxis`, `isActionHeld`, `getActionValue`; mouse/roda acumulados com `getTickMouseDelta`/`getTickWheelDelta`. No render: `isActionPressed`, `getMouseDelta`, `getWheelDelta` (por frame).
- Pausa: pressões durante a pausa são descartadas pelas consultas `*InTick`; para "continuar" use o evento `game.input.action` (`state: "pressed"`).
- `game.input.action` sai também com `state: "held"` a cada frame (filtre; `setActionEventOptions({ emitHeld: false })` desliga).
- `setBindingMap(map)` SUBSTITUI o mapa inteiro. Padrão: `Jump`=Space/GamepadButton0, `Interact`=KeyE/GamepadButton2, `Attack`=Mouse0/GamepadButton1; eixos `MoveForward` (W/S, d-pad, analógico esq.), `MoveRight` (D/A…), `LookRight`/`LookUp` (analógico dir.).
- Códigos: `KeyboardEvent.code`, `Mouse0..N`, roda `WheelUp/WheelDown/WheelLeft/WheelRight`, `Touch`, `GamepadButtonN`, meio-eixo `GamepadAxisN+`/`-`, por controle `Gamepad1Button0`. Eixos aceitam `positiveAlt`/`negativeAlt`.
- Filtros (padrão ligados): teclas ignoradas com foco em campo de texto/`[data-input-ignore]`; cliques/roda ignorados sobre button/a/input/label/`[data-input-ignore]` (telas e modais da UI já marcam); `preventDefault` das teclas mapeadas (Space/Tab). Ajuste em `setFilterOptions`.
- Pointer lock: `requestPointerLock()` → `game.input.pointer-lock-changed` (`reason: "lost"` quando o navegador solta). Gamepads: `getConnectedGamepads`, `game.input.gamepad-connection`.
- Getters de vetor devolvem objetos reutilizados: copie.
