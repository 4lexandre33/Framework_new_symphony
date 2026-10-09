## notas verificadas (comportamento)
- A engine bombeia `update()` do input; o jogo só lê ações/eixos.
- Bindings padrão existem; códigos de tecla são `KeyboardEvent.code` (ex.: `KeyW`, `Space`) e mouse é `Mouse0`, `Mouse1`…
- Teardown: devolva o dispose de qualquer listener registrado.
- Eixos padrão: `MoveForward` = KeyW(+1)/KeyS(−1); `MoveRight` = KeyD(+1)/KeyA(−1). Valor = soma de positivos − negativos (−1..1). Ação padrão `Attack` = Mouse0 / GamepadButton1.
