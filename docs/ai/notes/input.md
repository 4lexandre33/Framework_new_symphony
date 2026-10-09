## notas verificadas (comportamento)
- A engine bombeia `update()` do input; o jogo só lê ações/eixos.
- Bindings padrão existem; códigos de tecla são `KeyboardEvent.code` (ex.: `KeyW`, `Space`) e mouse é `Mouse0`, `Mouse1`…
- Teardown: devolva o dispose de qualquer listener registrado.
