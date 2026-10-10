# world — Gerenciador de Mundo, Cenas & ECS
capability: game.world@1.0.0 | category: functional | engine plugin id: game.world
consumes: AssetsToken, GameLoopToken
use (from src/projects/<jogo>/**):
  import { WorldToken } from "../../tokens/world";
  // acesso: const api = ctx.caps.require(Token)  (declare o token em capabilities.consumes + permissions.capabilities)

## token src/tokens/world.ts
```ts
interface WorldApi {
  readonly currentSceneId: string | null;
  readonly activeEntityCount: number;
  loadScene( scene: SceneDescriptor, options?: SceneLoadOptions, ): Promise<boolean>; // Carrega a cena: descarrega a anterior (padrão), pré-carrega `assetsToPreload` via `game.assets` (quando dispo…
  unloadScene( sceneId: string, ): Promise<boolean>; // Descarrega a cena ativa: emite `entity-despawned` para cada entidade, libera os assets pré-carregados e emite…
  spawnEntity( state: EntitySpawnInput, ): boolean; // Cria (ou substitui, com o mesmo id) uma entidade.
  despawnEntity( entityId: string, ): boolean;
  hasEntity( entityId: string, ): boolean;
  updateEntityTransform( entityId: string, patch: EntityTransformPatch, ): boolean; // Move/gira/escala uma entidade existente (índices espaciais atualizados na hora, sem eventos).
  patchEntity( entityId: string, patch: EntityStatePatch, ): boolean; // Atualiza qualquer campo (type, tags, customData, transform).
  getEntityState( entityId: string, ): EntityComponentState | null; // Snapshot IMUTÁVEL (congelado) da entidade.
  getAllEntities(): EntityComponentState[]; // Snapshots imutáveis de todas as entidades (array novo).
  querySpatialGrid( center: SpatialPoint2D, radius: number, ): SpatialQueryResult[]; // Consulta 2D no plano XZ (ignora Y), ordenada por distância.
  queryOctree( bounds: AABBBounds3D, ): SpatialQueryResult[]; // Consulta 3D por AABB (cobre o mundo todo: a octree se expande para entidades fora de `worldBounds`).
  querySphere( center: WorldPosition3D, radius: number, ): SpatialQueryResult[]; // Consulta 3D por esfera, ordenada por distância.
  serializeWorldState(): string;
  deserializeWorldState( serializedData: string, ): boolean; // Valida o JSON INTEIRO antes de tocar o mundo (em erro retorna false e o estado atual fica intacto).
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
interface SpatialQueryResult { // Resultado de consulta espacial (objeto novo, seguro para guardar).
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
  readonly showLoadingScreen?: boolean; // Repassado em todo `game.world.scene-loading` (`showLoadingScreen`) para a UI do jogo decidir se mostra a tela…
  readonly clearPreviousScene?: boolean; // Padrão true: descarrega a cena anterior (emitindo entity-despawned).
  readonly autoStartLoop?: boolean; // true: ao terminar, inicia/retoma o `game.loop` (se a capability existir).
  readonly failOnAssetError?: boolean; // true: falha de qualquer asset faz `loadScene` retornar false (a cena não fica ativa).
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
interface EntitySpawnInput { // Entrada de `spawnEntity`: só `entityId` é obrigatório.
  readonly entityId: string;
  readonly type?: string;
  readonly position?: Partial<WorldPosition3D>;
  readonly rotation?: WorldRotation;
  readonly scale?: Partial<WorldScale3D>;
  readonly tags?: ReadonlyArray<string>;
  readonly customData?: Record<string, unknown>;
}
interface EntityTransformPatch { // Atualização parcial de transform (campos ausentes ficam como estão).
  readonly position?: WorldPosition3D;
  readonly rotation?: WorldRotation;
  readonly scale?: WorldScale3D;
}
interface EntityStatePatch extends EntityTransformPatch { // Atualização parcial de qualquer campo (exceto entityId).
  readonly type?: string;
  readonly tags?: ReadonlyArray<string>;
  readonly customData?: Record<string, unknown>; // Substitui o customData inteiro (use spread para mesclar).
}
interface SceneLoadingPayload {
  readonly sceneId: string;
  readonly progressPercentage: number;
  readonly statusMessage: string;
  readonly showLoadingScreen: boolean; // Valor de `SceneLoadOptions.showLoadingScreen` (padrão false).
}
event SceneLoadingEvent = "game.world.scene-loading" payload SceneLoadingPayload
interface SceneLoadedPayload {
  readonly sceneId: string;
  readonly loadTimeMs: number;
  readonly totalEntities: number;
  readonly loadedAssets: number; // Assets pré-carregados com sucesso via `game.assets`.
  readonly failedAssets: ReadonlyArray<string>; // URLs que falharam (ou todas, se `game.assets` não estiver disponível).
}
interface SceneUnloadedPayload {
  readonly sceneId: string;
  readonly despawnedEntities: number;
}
event SceneUnloadedEvent = "game.world.scene-unloaded" payload SceneUnloadedPayload
interface WorldStateRestoredPayload {
  readonly sceneId: string | null;
  readonly totalEntities: number;
}
event WorldStateRestoredEvent = "game.world.state-restored" payload WorldStateRestoredPayload // Emitido após `deserializeWorldState` bem-sucedido.
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
  readonly state: EntitySpawnInput;
}
command SpawnEntityCommand = "game.world.spawn-entity" request SpawnEntityRequest
interface DespawnEntityRequest {
  readonly entityId: string;
}
command DespawnEntityCommand = "game.world.despawn-entity" request DespawnEntityRequest
interface UpdateEntityTransformRequest {
  readonly entityId: string;
  readonly patch: EntityTransformPatch;
}
command UpdateEntityTransformCommand = "game.world.update-entity-transform" request UpdateEntityTransformRequest
```
## notas verificadas (comportamento)
- `EntityComponentState` é imutável e NÃO há API para mover uma entidade. Para mover: `despawnEntity` + `spawnEntity` com o mesmo id (emite eventos; não faça por tick) ou mantenha no `world` só entidades paradas no seu referencial.
- Os índices espaciais (`querySpatialGrid`, `queryOctree`) são atualizados no tick pela engine.
- `world` é só dado (ECS + consultas): não cria malha nem corpo físico.
- `game.ai` lê `world.getEntityState` em `registerAgent` (posição inicial) e em `setAgentTargetEntity` (posição do alvo no momento da chamada).
- `spawnEntity` com id existente SOBRESCREVE (move) e reemite `entity-spawned` (G6). Todos os campos obrigatórios (G67). `queryOctree` só dentro de ±500 sem `worldBounds` (G64).
