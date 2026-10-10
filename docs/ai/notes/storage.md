## notas verificadas (comportamento)
- Driver padrão `sqlite_local` = `localStorage` do navegador (não precisa de Tauri). `steam_cloud` também usa `localStorage` (prefixo `steam_cloud_save_`). `cloud_database` não salva slots (lança).
- Slot inexistente: `loadGame` resolve `null`. Falhas de escrita rejeitam a Promise.
- Em vitest no ambiente node não há `localStorage` (lança): nos testes do jogo use um mock de `StorageApi`.
- Só dados serializáveis em JSON.
- Ponha no TOPO de `data` os campos `playTimeSeconds` (número) e `gameVersion` (string), e um `schemaVersion` seu (G103). Slots só `[A-Za-z0-9_-]` com prefixo do jogo (G102). Save corrompido REJEITA (`code:"corrupted"`): try/catch sempre (G101). Perfil online é falso (G100).
