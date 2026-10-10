## notas verificadas (comportamento)
- IMPORTANTE: `game.camera` escreve posição/rotação (e fov se perspectiva) na câmera ativa do render A CADA FRAME. Sem câmera virtual registrada, ela força posição (0,5,10) e rotação identidade. Logo `RenderApi.setCameraMode`/`updateCameraTarget` não têm efeito visível: controle a câmera SÓ por `game.camera`.
- `registerVirtualCamera` com um id existente SUBSTITUI a câmera e zera o shake (trauma). Use re-registro só para mudanças raras (ex.: girar 90°). Para seguir/zoom use spring-arm.
- `setFollowTarget(cameraId, pos)` só guarda o alvo; chame a cada tick com a posição atual.
- Câmera SEM `springArmConfig`: posição é sempre `descriptor.position` (fixa); `followTarget` não a move.
- COM `springArmConfig` + `setFollowTarget`: posição = alvo + `targetOffset` + (0,0,1) girado pela `rotation` da câmera × comprimento do braço (a câmera fica "atrás" e olha para o alvo). `fov` inválido cai para 60.
- Campos obrigatórios do spring-arm: `targetArmLength`, `probeRadius`, `socketOffset`, `targetOffset`. `configureSpringArm(id, {targetArmLength})` muda o zoom SEM zerar o shake.
- `addTrauma(0..1)` sacode a câmera ativa (decai sozinho).
- Isométrica: `rotation` = quaternion de yaw 45° e pitch −35°; spring-arm com braço 25–60; zoom = `configureSpringArm`. Receita: `docs/ai/RECIPES.md` (10-camera).
