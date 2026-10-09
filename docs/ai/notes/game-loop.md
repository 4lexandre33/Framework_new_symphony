## notas verificadas (comportamento)
- O loop inicia no evento `kernel.booted`; não inicie manualmente.
- O payload do tick é REUTILIZADO entre ticks: não guarde a referência; copie os números que precisar.
- Simulação usa passo fixo; render usa frame variável. Lógica de jogo no tick, visual no frame.
