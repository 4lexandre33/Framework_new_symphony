## notas verificadas (comportamento)
- `update()` é NO-OP (a engine chama no tick, mas não carrega nada). O jogo decide quais chunks existem: `requestChunk(coord)` e `unloadChunk(coord)`.
- Chunk = 16×128×16 voxels; a malha fica em (coord.x×16, coord.y×128, coord.z×16). Use `coord.y = 0`.
- Geração assíncrona (worker): espere `game.terrain.chunk-generated` antes de consultar voxels daquele chunk. A malha é adicionada à cena automaticamente; `unloadChunk`/`clear` remove.
- Biomas (por `getBiomeAt`): `desert` (bloco 4, alt. 10–40), `forest` (bloco 3/1, 20–80), `tundra` (5/2, 60–120), `mountains` (2, 80–200). Mesma seed → mesmo terreno.
- LACUNA: todos os blocos usam a MESMA cor (verde) e não há colisores de terreno. Altura da superfície: varra `getVoxelBlock` de y=127 para baixo até `id !== 0` (faça na geração, não por tick).
- CUSTO: cada `modifyVoxelBlock` que muda o bloco remonta a malha do chunk inteiro (síncrono). Limite a poucas modificações por tick (≤ 8) e nunca escave corredores longos.
