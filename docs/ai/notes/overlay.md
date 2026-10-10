## notas verificadas (comportamento)
- Sem Tauri: `setPassthrough`/`setAlwaysOnTop` resolvem e só guardam estado; `dockToTaskbar` resolve `true` com limites simulados.
- `performHitTest` só detecta DOM (o raycast 3D não está ligado).
- SUSPEITA DE BUG (verificar no Tauri): a engine chama `update(0,0,dt)` a cada tick, o que reavalia o passthrough pelo elemento no pixel (0,0). Não ative modos de overlay no jogo sem testar no app nativo.
- Confirmado (G15): a janela só passa a ignorar o mouse se o pixel (0,0) não tiver elemento interativo; o passthrough do jogo é desfeito a cada tick. A janela do template nasce sempre-no-topo e sem bordas (G32): chame `setAlwaysOnTop(false)` no boot.
