## notas verificadas (comportamento)
- A engine chama o tick/render da animação. Não chame `update` no jogo.
- Para modelos voxel segmentados: crie `THREE.AnimationClip`s no adapter (tracks `.quaternion`/`.position` de filhos nomeados), passe em `register3DSkeleton(entityId, root, clips)` e registre estados com `registerState` (`config.id` = nome do clip, `config.name` = nome do estado). Inicie com `playAnimation`.
- Transições automáticas por parâmetro: `addTransition({fromState,toState,durationSeconds,conditionParam,conditionOperator,conditionValue})` + `setParam`.
- `unregisterEntity` no dispose.
