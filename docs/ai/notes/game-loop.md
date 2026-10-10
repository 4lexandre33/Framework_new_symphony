## notas verificadas (comportamento)
- O loop inicia no evento `kernel.booted`; não inicie manualmente.
- O payload do tick é REUTILIZADO entre ticks: não guarde a referência; copie os números que precisar.
- Simulação usa passo fixo; render usa frame variável. Lógica de jogo no tick, visual no frame.
- Padrão: 60 ticks/s (`deltaSeconds` ≈ 1/60). Delta de frame limitado a 0,25 s e no máximo 60 passos fixos por frame (após travadas, a simulação não "recupera" mais que isso).
- `pause()` congela o tick E o evento `game.loop.render` (a imagem fica parada); DOM/menus continuam funcionando. Não pause o loop para telas que precisam de 3D animado (lobby, cutscene): use um estado do próprio jogo.
