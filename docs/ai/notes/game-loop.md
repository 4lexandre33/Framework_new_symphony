## notas verificadas (comportamento)
- O loop inicia sozinho em `kernel.booted`. Padrão 60 ticks/s; frame limitado a 0,25 s e 60 passos fixos por frame (sem "recuperar" travadas).
- Simulação no `game.loop.tick` (passo fixo); visual no `game.loop.render` (`alphaInterpolation`, `deltaSeconds`, `realDeltaSeconds`, `isPaused`).
- `pause()` para os ticks mas o render CONTINUA (`isPaused: true`, `deltaSeconds: 0`, `realDeltaSeconds` real): menus e lobby animados funcionam. `pause({ freezeRender: true })` congela também a imagem. `resume()` não recupera o tempo pausado.
- Tudo que roda no tick (física, IA, scripting, bordas `*InTick` do input) para durante a pausa: trate a tecla de "continuar" no evento `game.input.action` ou no render.
- Aba/janela oculta: o loop suspende e, na volta, ressincroniza sem catch-up (`getStats().isHidden`). O pump de rede também para (GAPS G130).
- Payloads de tick/render são REUTILIZADOS: leia na hora ou copie com `copyTickPayload`/`copyRenderPayload`; nunca mute (em DEV é detectado e revertido).
- `setTickRate(1..240)` e `setTargetFps(0 | 1..1000)` devolvem `false` para valor inválido. Use `pause/resume`, não `stop/start`.
