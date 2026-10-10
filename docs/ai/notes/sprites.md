## notas verificadas (comportamento)
- Sprites e tilemaps são malhas na MESMA cena 3D do render (não há câmera/overlay 2D separado). Use para painéis no mundo (ex.: mapa na cabine) ou ícones flutuantes.
- A textura do atlas vem do cache de `game.assets`: `await loadTexture(atlasUrl)` antes; use o próprio `atlasUrl` como `atlasKey` em `parseAtlas`/`getFrameUV`.
- `spawnSprite2D` devolve o `THREE.Mesh`; oriente-o você mesmo (ex.: copiar o quaternion da câmera) para encarar a vista. Mesmo `spriteId` substitui. `despawnSprite2D` no dispose.
- Tilemap: o número `N` em `tiles` usa o frame do atlas chamado `tile_N`; valor negativo = vazio. Linhas crescem para −Y, colunas para +X a partir de `position`, cada tile `tileSize` de lado (plano XY). Chamar `renderTilemap` de novo com o MESMO `layerId` substitui o anterior.
