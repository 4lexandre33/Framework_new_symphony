## notas verificadas (comportamento)
- Offline/sem Tauri: `getLoadedMods()` = `[]`, `enableMod`/`downloadWorkshopMod` resolvem `false`, `publishWorkshopMod` REJEITA.
- `registerAssetOverride`/`getAssetOverride` funcionam em memória (descritor inválido lança). Padrão: resolva toda URL de asset do jogo por `getAssetOverride(caminho) ?? caminho`.
