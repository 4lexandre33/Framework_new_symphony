## notas verificadas (comportamento)
- A engine avança FSM, mixer 3D e sprites 2D num relógio ÚNICO: "tick" (padrão, determinístico) ou "render" (`setClockSource`). Não chame `update`. Pausado, nada avança.
- Modelo voxel segmentado: crie `THREE.AnimationClip`s no adapter (tracks `.quaternion`/`.position` de filhos nomeados), `register3DSkeleton(entityId, root, clips)` e `registerState(entityId, { id: nomeDoClip, name: nomeDoEstado, loopMode })`. Ordem livre: transições podem vir antes dos estados; o 1º estado explícito vira o inicial e toca no próximo passo (`state-changed` de "none").
- `durationSeconds` é opcional (usa a duração do clip).
- Transições: `addTransition({ fromState, toState, durationSeconds, conditionParam, conditionOperator, conditionValue })` + `setParam`. SEM condição a transição espera o fim do clip (exitTime 1); `exitTime`/`hasExitTime` ajustam.
- Ações (golpe, reparo): estado `LoopOnce` + transição sem condição de volta ao Idle, ou reaja a `game.anim.clip-finished`. Repetir o estado atual: `playAnimation(id, estado, fade, { restart: true })` (um `LoopOnce` já terminado reinicia sozinho).
- Triggers (`frameOrTime` 0..1) disparam a cada ciclo (`game.anim.event-triggered`).
- `getCurrentState` continua o de origem durante o crossfade; o pedido está em `getTargetState`/`getStateInfo().requestedState`.
- Sprites 2D: `register2DSprite` + `register2DSpriteState(id, estado, quadros)`; a textura é clonada por entidade quando compartilhada.
- `unregisterEntity` no dispose.
