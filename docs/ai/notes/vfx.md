## notas verificadas (comportamento)
- A engine chama `update(dt)` no `game.loop.render` com o delta do frame: emissores e decals congelam com o jogo pausado.
- Partículas: `spawnParticleEmitter(config)` (THREE.Points + shader; mesmo id substitui e libera o anterior). `position` em mundo; mova com `setEmitterPosition` (partículas já nascidas seguem livres). `gravityScale` multiplica 9,81 (0 = sem gravidade). Tamanhos em unidades de mundo.
- Duração: com `durationSeconds` o emissor para de emitir e se remove sozinho quando a última partícula morre (`game.vfx.emitter-finished`); sem ela emite até `stopParticleEmitter(id, { graceful: true })`. `burstCount` = rajada inicial; `burstParticles(id, n)` emite extra (taxa controlada pelo jogo: `spawnRatePerSecond: 0` + burst por tick).
- Emissão sai de um PONTO (sem volume); efeitos de área = vários emissores ou variância de velocidade.
- `getActiveParticleCount()` soma os slots (`maxParticles`) registrados: use para orçamento.
- Presets: `registerVFXPreset({ presetId, particleEmitter?, decal?, screenShakeTrauma?, postFXPulseBloomStrength? })` + `triggerVFXPresetById(id, { position, instanceId })`.
- Decals PROJETADOS sobre as malhas que cruzam a caixa `size` (z = profundidade); estáticos. `decalId` identifica (mesmo id substitui; `removeDecal(id)`); sem `lifetimeSeconds` é permanente; limite `setMaxDecals` (padrão 200, recicla o mais antigo). Textura vem do cache (carregada se faltar). `clearDecals()` no dispose.
- Pós-processamento real (EffectComposer): `configurePostProcessing({ enableBloom, bloomStrength, enableSSAO, … })` liga (salvo `enabled: false`); `isPostProcessingActive()`; `pulseBloom(força, s)`. Custa GPU: ofereça opção para desligar.
