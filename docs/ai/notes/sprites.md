## notas verificadas (comportamento)
- BUG GRAVE (G92): o plugin não declara acesso ao render/assets. `spawnSprite2D`, `despawnSprite2D`, `renderTilemap`, `createParallaxBackground`, `clear`, `dispose` e os comandos LANÇAM erro. Funcionam só `parseAtlas`, `getFrameUV`, `updateParallax`, `setPixelPerfectScaling`.
- BUG (G93): mesmo corrigido o acesso, o shader do tilemap mostraria o atlas inteiro em cada tile.
- Uso recomendado hoje: `await assets.loadTexture(url)` → `parseAtlas(url, json, texture)` → `getFrameUV(url, nome)` para obter UVs; desenhe sprites/tilemaps com malhas do PRÓPRIO jogo (`PlaneGeometry`/`InstancedMesh` + `MeshBasicMaterial`, `addMeshToScene`).
- Convenção do tilemap da engine (para quando for corrigido): o número N em `tiles` usa o frame `tile_N`; −1 = vazio; mesmo `layerId` substitui.
