## notas verificadas (comportamento)
- Chunk = 16×256×16 voxels (`TERRAIN_CHUNK_SIZE_*`); malha em (x·16, y·256, z·16). Use `coord.y = 0` (0..255 cobre todos os biomas).
- A engine chama `update` no tick (e monta malhas em frames pausados): streaming automático (se ligado), colliders e montagem de malhas dentro do orçamento (`meshing: { maxMeshesPerUpdate: 2, budgetMs: 4 }`).
- Quem carrega chunks: (a) streaming da engine — `configure({ streaming: { enabled: true, radiusChunks, centerSource: "camera" | "explicit" } })` + `setStreamingCenter(pos)`; ou (b) o jogo — `requestChunk` (idempotente; chunk pedido à mão fica FIXO) / `unloadChunk`. Espere `game.terrain.chunk-generated` (ou `isChunkReady`) antes de ler voxels.
- `getSurfaceHeight(x, z)` = Y do bloco sólido mais alto; funciona também para colunas NÃO carregadas (amostra o gerador, síncrono, determinístico pela seed; edições só contam se carregado).
- Colliders trimesh por chunk são criados por padrão (`colliders: { enabled }`); água/blocos `solid: false` ficam fora. Terreno só visual: desligue (GAPS G133).
- Padrão de geração: água até `seaLevel` 16 (desligue com `-1`), sem cavernas. Biomas (`getBiomeAt`): desert 10–40, forest 20–80, tundra 60–120, mountains 80–200, com transição suave. Mesma seed ⇒ mesmo terreno.
- Cores: paleta por id (`TerrainBlockIds`, `setBlockDefinition`, `configure({ palette, biomeTints })`).
- Edições: `modifyVoxelBlock` remonta o chunk na hora; para muitas use `modifyVoxelBlocks` (uma remontagem por chunk). Edições PERSISTEM após unload; salve com `exportEdits`/`importEdits`.
- `setSeed` com chunks/edições descarta tudo e emite `game.terrain.reset`; `clear()` também emite (as edições ficam, use `clearEdits`).
