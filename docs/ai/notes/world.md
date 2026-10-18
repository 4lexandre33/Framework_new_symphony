## notas verificadas (comportamento)
- `world` é só dado (ECS + consultas): não cria malha nem corpo físico.
- `spawnEntity` exige só `entityId` (o resto tem padrão); mesmo id SUBSTITUI e reemite `entity-spawned`.
- Mover/alterar: `updateEntityTransform(id, { position?, rotation?, scale? })` (índices na hora, SEM eventos; pode ser por tick) e `patchEntity(id, { tags?, customData?, type? })` (`customData` substitui inteiro).
- `getEntityState` devolve snapshot IMUTÁVEL (congelado, seguro para guardar); `hasEntity`, `getAllEntities`.
- Consultas: `querySpatialGrid({x,z}, r)` (plano XZ, incremental), `querySphere(c, r)` e `queryOctree(aabb)` (3D; a octree cresce além de `worldBounds`). Resultados são objetos novos ordenados por distância real. Muitas entidades móveis + consultas 3D por tick: prefira o grid (GAPS G67).
- Cena: `loadScene(desc, { clearPreviousScene, autoStartLoop, failOnAssetError, showLoadingScreen })` pré-carrega `assetsToPreload` via `game.assets` (progresso em `scene-loading`); `unloadScene` emite `entity-despawned` + `scene-unloaded` e libera os assets.
- `serializeWorldState`/`deserializeWorldState`: valida o JSON inteiro antes (erro ⇒ `false`, mundo intacto), restaura `sceneId` e emite `state-restored`.
- `game.ai` lê a posição inicial do agente da entidade do world; `game.scripting` rastreia entidades do world por tags (`trackEntity`).
