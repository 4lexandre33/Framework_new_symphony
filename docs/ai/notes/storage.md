## notas verificadas (comportamento)
- No boot do jogo: `configureSaves({ namespace: "<jogo>", schemaVersion, gameVersion, backupCount?, integrityKey? })` — sem namespace os slots são compartilhados entre jogos do mesmo app.
- Backend: `localStorage` do navegador/WebView (driver padrão `sqlite_local`); sem Web Storage (node/vitest) cai em MEMÓRIA sozinho (`getBackendInfo().persistent === false`). `steam_cloud` é o mesmo localStorage (GAPS G131); `cloud_database` não guarda slots.
- Slots: qualquer nome não vazio (codificado com segurança; espaços/acentos não colidem). `saveGame(slot, data, driver?, { playTimeSeconds, gameVersion, schemaVersion, label })` resolve com os metadados; falha REJEITA (`code`, ex. `quota-exceeded`) e emite `save-completed` com `success: false`.
- Carregar: `loadGameDetailed(slot)` NUNCA rejeita por corrupção (`status`: ok/recovered/missing/corrupted, usa backup se preciso + `save-recovered`); `loadGame` resolve `null` sem slot e REJEITA se corrompido sem backup. Migrações: `registerMigration(de, fn)` (de → de+1) rodam no load.
- `listSaves` lê um índice (barato). `deleteSave` apaga também os backups.
- Só dados serializáveis em JSON; saves pequenos (cota ~5 MB, escrita síncrona: GAPS G102).
- Perfil online: sem backend `syncOnlineProfile` resolve `false` (`error: "unsupported"`); plugue com `configureOnlineProfile({ endpoint })` ou `setOnlineProfileBackend`.
- Testes do jogo: mock/fake parcial de `StorageApi`.
