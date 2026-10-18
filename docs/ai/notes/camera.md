## notas verificadas (comportamento)
- Sem câmera virtual (ou com `setEnabled(false)`) a câmera do render NÃO é tocada. Com câmera registrada, `game.camera` escreve posição/rotação/fov da câmera ativa no `game.loop.render`.
- Ativa = maior `priority` (no registro ou em `setCameraPriority`), com `game.camera.state-changed`; `setActiveCamera(id, blend?)` força outra (sem blend usa `descriptor.blendDurationSeconds`, padrão 0,5 s; `0` corta).
- Seguir: `followTargetId`/`lookAtTargetId` = ids de corpos físicos (posição lida a cada frame) ou `setFollowTarget(id, pos)`/`setLookAtTarget(id, pos | null)` com números COPIADOS (chame quando o alvo mudar; `clearFollowTarget` volta ao id).
- Sem spring-arm: `position` é fixa; com alvo vira o OFFSET em relação ao alvo. Com `springArmConfig`: câmera atrás do alvo pela `rotation`, a `targetArmLength` (obrigatórios: `targetArmLength`, `probeRadius`, `socketOffset`, `targetOffset`); zoom = `configureSpringArm(id, { targetArmLength })`.
- Colisão do braço: padrão ligada só quando há entidade a ignorar (`followTargetId` ou `collisionIgnoreEntityId`); o raio ignora o alvo e sensores. `enableCollision: false` para câmera isométrica estável.
- Re-registrar o mesmo id substitui o descritor e PRESERVA trauma, alvos e status de ativa (girar 90° = re-registro com nova `rotation`).
- Shake: `addTrauma(0..1)` é GLOBAL (sobrevive a troca/re-registro; usa o `shakeConfig` da ativa); blend e shake congelam com o jogo pausado.
- `detectOcclusion: true` emite `game.camera.occlusion-changed` (ids físicos entre câmera e alvo). Fade automático opcional (G47): `occlusionFade: true | { opacity: 0.3, fadeSeconds: 0.2, meshKeyPrefix: "" }` (implica a detecção); a malha é `render.getMeshFromScene(prefixo + entityId)`, os materiais viram CLONES transparentes (o original/compartilhado não muda) e voltam ao desocluir, trocar de câmera ou no dispose.
- Isométrica: `rotation` = yaw 45° + pitch −35°, braço 25–60, fov ~35 (receita 10-camera).
