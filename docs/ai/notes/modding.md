## notas verificadas (comportamento)
- Offline/sem Tauri: `getLoadedMods()` = `[]`, `enableMod`/`downloadWorkshopMod` resolvem `false`, `publishWorkshopMod` REJEITA.
- `registerAssetOverride`/`getAssetOverride` funcionam em memória (descritor inválido lança). Padrão: resolva toda URL de asset do jogo por `getAssetOverride(caminho) ?? caminho`.
- Mods não executam código, Workshop não instala e publicar falha mesmo no app nativo (G116–G118).
