## notas verificadas (comportamento)
- Só corpos `dynamic` recebem `applyImpulse`/`applyForce`; nos outros retorna false.
- `applyForce` é persistente (não há reset automático): aplique a cada tick só enquanto quiser a força.
- Eventos de colisão trazem o par `entityIdA`/`entityIdB` (ordem não garantida); `isTrigger` true apenas com collider `isSensor`.
- `castRay` parte de `origin`: se o raio nascer dentro do próprio corpo ele o acerta. Comece abaixo/além da base do corpo.
- `syncMeshTransform(id, mesh)` MUTA `mesh.position` e `mesh.quaternion` (copia do corpo para a malha).
- Avance a física só pelo tick fixo do game-loop (`step(dt)`); não chame `step` no render.
