## notas verificadas (comportamento)
- A engine chama `update(dt)` no `game.loop.render`. Não chame `update` no jogo.
- `spawnParticleEmitter` funciona sem `textureUrl` (desenha círculo suave); as partículas entram na cena do render automaticamente. `emitterId` repetido substitui o emissor. Pare com `stopParticleEmitter` no dispose.
- `projectDecal` lê a textura do cache de `game.assets`: carregue antes com `loadTexture(url)`; sem isso usa textura vazia.
- LACUNA: `configurePostProcessing`/`pulseBloom` só guardam estado e emitem `game.vfx.postfx-changed`; NÃO há bloom/SSAO desenhado (sem EffectComposer).
- LACUNA: não há como mover um emissor. Para fumaça/fogo em algo que se move, re-emita emissores curtos (ex.: a cada 0,5 s, ids em rodízio `fumaca-0..3`) na posição atual e pare os antigos.
