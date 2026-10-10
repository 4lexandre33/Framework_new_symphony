## notas verificadas (comportamento)
- BUG GRAVE (G88): as partículas da engine NÃO aparecem no navegador (shader inválido); em testes parecem funcionar. Parar/substituir emissor vaza GPU (G89). Não use `spawnParticleEmitter`/`triggerVFXPreset` com emissor para efeitos visíveis: faça partículas no jogo (`InstancedMesh` de cubos ou `THREE.Points` via `addMeshToScene`).
- Decals funcionam como caixa texturizada (G90): textura precisa estar no cache (`loadTexture` antes), use `size.z` ≈ 0,01, sempre `lifetimeSeconds`; `decalId` não identifica (duplica); `clearDecals()` no dispose.
- Pós-processamento não é desenhado (G9). `gravityScale` é aceleração absoluta (G91).
- A engine chama `update(dt)` no `game.loop.render`.
