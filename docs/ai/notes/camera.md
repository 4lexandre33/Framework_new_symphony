## notas verificadas (comportamento)
- `setFollowTarget(cameraId, targetPosition)` apenas guarda a posição alvo na câmera virtual; o jogo deve chamá-lo a cada tick com a posição atual do alvo.
- Câmera virtual SEM `springArmConfig`: a posição é sempre `descriptor.position` (fixa); `followTarget` não a move.
- COM `springArmConfig` e alvo definido por `setFollowTarget`: a posição é calculada pelo spring-arm (`targetArmLength`, `targetOffset`, `socketOffset`, `probeRadius`; colisão só se `enableCollision`) a partir do alvo e da rotação da câmera. `fov` inválido cai para 60.
- Campos obrigatórios do spring-arm: `targetArmLength`, `probeRadius`, `socketOffset`, `targetOffset`.
