## notas verificadas (comportamento)
- Driver padrão `sqlite_local` = `localStorage` do navegador (não precisa de Tauri). `steam_cloud` também usa `localStorage` (prefixo `steam_cloud_save_`). `cloud_database` não salva slots (lança).
- Slot inexistente: `loadGame` resolve `null`. Falhas de escrita rejeitam a Promise.
- Em vitest no ambiente node não há `localStorage` (lança): nos testes do jogo use um mock de `StorageApi`.
- Só dados serializáveis em JSON.
