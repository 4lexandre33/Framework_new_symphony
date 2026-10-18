## notas verificadas (comportamento)
- A janela do app nasce como janela comum (bordas, não sempre-no-topo, opaca). Cada jogo pode ter `src/projects/<jogo>/desktop.json` (`productName`, `identifier`, `window: { title, width, height, resizable, fullscreen, decorations, alwaysOnTop, transparent }`); janela transparente/sem bordas é opt-in ali (transparência só na criação).
- Passthrough: política `manual` (padrão) — `setPassthrough(true)` vale até você desligar; `auto` (`setPassthroughPolicy("auto")`) segue o cursor real e só ignora cliques onde não há DOM interativo nem malha 3D (raycast do render já ligado; `setRaycastProvider` troca).
- `setOverlayMode("window" | "desktop_pet" | "taskbar_dock" | "always_on_top_hud")` aplica as flags nativas e devolve `{ applied, state, errors }`. `setPassthrough`/`setAlwaysOnTop` REJEITAM com o erro nativo (o estado não muda): use try/catch. Getters (`isAlwaysOnTop`, `isPassthroughActive`) refletem o estado real; `lastError` explica falhas.
- Sem Tauri: tudo simulado com `state.native === false` (não mente sobre a janela); `dockToTaskbar` resolve `false` com `lastError` "unsupported".
- No dispose: `restoreWindow()` (ou `clear()`) reverte a janela ao estado do boot.
- Flags nativas não verificadas numa janela Tauri real (GAPS NV).
