## notas verificadas (comportamento)
- A engine chama `update` no tick. Centro: por padrão a posição da câmera ativa (`game.camera`); `updateStreamingCenter(pos)` passa a origem para "explicit" (a câmera para de sobrescrever); `setCenterSource("camera")` volta. A distância inclui Y.
- Setores: `registerSector({ sectorCoord, boundsMin, boundsMax, assetUrls, priority? })`. Ao entrar no raio os `assetUrls` são carregados via `game.assets` e sai `game.streaming.sector-loaded`; ao sair, liberados + `sector-unloaded`. O jogo cria/remove o conteúdo do setor nesses eventos (`getSectorAsset(coord, url)` dá a instância carregada).
- Raio padrão 100 (+15 de histerese): `setStreamingRadius(load, histerese)`.
- Manual: `loadSector` FIXA o setor (pinned) até `releaseSector`/`unloadSector`; `unloadSector` suprime até ele sair do raio. `unregisterSector` remove com evento; `clear()` descarrega tudo com eventos.
- LOD: `registerLODEntity` avalia o nível JÁ (níveis em qualquer ordem); `updateLODEntityPosition` move; histerese por entidade ou `setLODHysteresis`. `game.streaming.lod-changed` traz `newLevel`. `meshUrl` não vazio é CARREGADO via assets: LOD feito pelo jogo usa `meshUrl: ""` (GAPS G132).
- HLOD real: `buildHLOD(coord, chavesDeCena, { switchDistance, hideSources })` funde malhas da cena num proxy por material; `removeHLOD`; `getHLODStats()`.
