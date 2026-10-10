# world — Gerenciador de Mundo, Cenas & ECS
capability: game.world@1.0.0 | category: functional | engine plugin id: game.world
use (from src/projects/<jogo>/**):
  import { WorldToken } from "../../tokens/world";
  // acesso: const api = ctx.caps.require(Token)  (declare o token em capabilities.consumes + permissions.capabilities)

## token src/tokens/world.ts
```ts
interface WorldApi {
  readonly currentSceneId: string | null;
  readonly activeEntityCount: number;
  loadScene( scene: SceneDescriptor, options?: SceneLoadOptions, ): Promise<boolean>;
  unloadScene( sceneId: string, ): Promise<boolean>;
  spawnEntity( state: EntityComponentState, ): boolean;
  despawnEntity( entityId: string, ): boolean;
  getEntityState( entityId: string, ): EntityComponentState | null;
  querySpatialGrid( center: SpatialPoint2D, radius: number, ): SpatialQueryResult[];
  queryOctree( bounds: AABBBounds3D, ): SpatialQueryResult[];
  serializeWorldState(): string;
  deserializeWorldState( serializedData: string, ): boolean;
}
capability WorldToken = "game.world"@1.0.0 api WorldApi
```
## contract src/contracts/world/types.ts
```ts
interface WorldPosition3D {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
interface SpatialPoint2D {
  readonly x: number;
  readonly z: number;
}
interface WorldRotation {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}
interface WorldScale3D {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
interface AABBBounds3D {
  readonly min: WorldPosition3D;
  readonly max: WorldPosition3D;
}
interface SpatialQueryResult {
  readonly entityId: string;
  readonly distance: number;
  readonly position: WorldPosition3D;
}
export type SceneAssetType = | "gltf" | "texture" | "audio";
interface SceneAssetDescriptor {
  readonly id: string;
  readonly url: string;
  readonly type: SceneAssetType;
}
interface SceneDescriptor {
  readonly sceneId: string;
  readonly sceneName: string;
  readonly assetsToPreload: ReadonlyArray<SceneAssetDescriptor>;
  readonly initialEntitiesCount?: number;
  readonly worldBounds?: AABBBounds3D;
}
interface SceneLoadOptions {
  readonly showLoadingScreen?: boolean;
  readonly clearPreviousScene?: boolean;
  readonly autoStartLoop?: boolean;
}
interface EntityComponentState {
  readonly entityId: string;
  readonly type: string;
  readonly position: WorldPosition3D;
  readonly rotation: WorldRotation;
  readonly scale: WorldScale3D;
  readonly tags: ReadonlyArray<string>;
  readonly customData: Record<string, unknown>;
}
interface SceneLoadingPayload {
  readonly sceneId: string;
  readonly progressPercentage: number;
  readonly statusMessage: string;
}
event SceneLoadingEvent = "game.world.scene-loading" payload SceneLoadingPayload
interface SceneLoadedPayload {
  readonly sceneId: string;
  readonly loadTimeMs: number;
  readonly totalEntities: number;
}
event SceneLoadedEvent = "game.world.scene-loaded" payload SceneLoadedPayload
interface EntitySpawnedPayload {
  readonly entityId: string;
  readonly type: string;
  readonly position: WorldPosition3D;
}
event EntitySpawnedEvent = "game.world.entity-spawned" payload EntitySpawnedPayload
interface EntityDespawnedPayload {
  readonly entityId: string;
}
event EntityDespawnedEvent = "game.world.entity-despawned" payload EntityDespawnedPayload
interface LoadSceneRequest {
  readonly scene: SceneDescriptor;
  readonly options?: SceneLoadOptions;
}
command LoadSceneCommand = "game.world.load-scene" request LoadSceneRequest
interface UnloadSceneRequest {
  readonly sceneId: string;
}
command UnloadSceneCommand = "game.world.unload-scene" request UnloadSceneRequest
interface SpawnEntityRequest {
  readonly state: EntityComponentState;
}
command SpawnEntityCommand = "game.world.spawn-entity" request SpawnEntityRequest
interface DespawnEntityRequest {
  readonly entityId: string;
}
command DespawnEntityCommand = "game.world.despawn-entity" request DespawnEntityRequest
```
## notas verificadas (comportamento)
- `EntityComponentState` é imutável e NÃO há API para mover uma entidade. Para mover: `despawnEntity` + `spawnEntity` com o mesmo id (emite eventos; não faça por tick) ou mantenha no `world` só entidades paradas no seu referencial.
- Os índices espaciais (`querySpatialGrid`, `queryOctree`) são atualizados no tick pela engine.
- `world` é só dado (ECS + consultas): não cria malha nem corpo físico.
- `game.ai` lê `world.getEntityState` em `registerAgent` (posição inicial) e em `setAgentTargetEntity` (posição do alvo no momento da chamada).
