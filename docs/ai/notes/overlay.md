## notas verificadas (comportamento)
- Sem Tauri: `setPassthrough`/`setAlwaysOnTop` resolvem e só guardam estado; `dockToTaskbar` resolve `true` com limites simulados.
- `performHitTest` só detecta DOM (o raycast 3D não está ligado).
- SUSPEITA DE BUG (verificar no Tauri): a engine chama `update(0,0,dt)` a cada tick, o que reavalia o passthrough pelo elemento no pixel (0,0). Não ative modos de overlay no jogo sem testar no app nativo.
