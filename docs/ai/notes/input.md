## notas verificadas (comportamento)
- A engine bombeia `update()` do input por `requestAnimationFrame` (NÃO pelo tick). Por isso `isActionPressed/Released` lidos dentro de `game.loop.tick` podem perder ou duplicar a borda. Para ações de toque único (interagir, largar, pular) escute o evento `game.input.action` (`state === "pressed"`). Para contínuos (`getAxis`, `isActionHeld`) leia no tick.
- `setBindingMap(map)` SUBSTITUI o mapa inteiro: inclua todas as ações E os eixos `MoveForward`/`MoveRight` no seu mapa.
- Mapa padrão: ações `Jump`=Space/GamepadButton0, `Interact`=KeyE/GamepadButton2, `Attack`=Mouse0/GamepadButton1; eixos `MoveForward` = KeyW(+1)/KeyS(−1), `MoveRight` = KeyD(+1)/KeyA(−1). Valor = soma positivos − negativos (−1..1).
- Códigos: `KeyboardEvent.code` (`KeyW`, `Space`, `ShiftLeft`, `Tab`), mouse `Mouse0`/`Mouse1`/`Mouse2`, gamepad `GamepadButtonN`. O analógico do gamepad só alimenta eixos chamados exatamente `MoveForward` e `MoveRight`.
- LACUNA: não há roda do mouse. Para zoom, registre `wheel` no DOM dentro de um adapter do jogo (com `{ passive: true }`) e remova no dispose.
- Teardown: devolva o dispose de qualquer listener registrado.
- `game.input.action` sai A CADA FRAME para ações mantidas (`state:"held"`): filtre `pressed`/`released`. Toque curtíssimo emite `pressed` sem `released` (G50): "segurando" sempre por `isActionHeld` no tick.
- Teclas/cliques são capturados mesmo com um campo de texto em foco (G51): ignore ações enquanto a UI do jogo tiver foco; `preventDefault` de Space/Tab num adapter. `getMouseDelta()` leia no render (G52).
