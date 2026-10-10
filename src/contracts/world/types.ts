import {
  defineCommand,
  defineEvent,
} from "@core";

/* ============================================================================
 * TIPOS MATEMÁTICOS DE MUNDO
 * ========================================================================== */

export interface WorldPosition3D {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface SpatialPoint2D {
  readonly x: number;
  readonly z: number;
}

export interface WorldRotation {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export interface WorldScale3D {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/* ============================================================================
 * SPATIAL
 * ========================================================================== */

export interface AABBBounds3D {
  readonly min: WorldPosition3D;
  readonly max: WorldPosition3D;
}

/**
 * Resultado de consulta espacial (objeto novo, seguro para guardar).
 * Resultados vêm ordenados por `distance` crescente.
 * - querySpatialGrid: distância no plano XZ até o centro;
 * - queryOctree: distância 3D até o centro do AABB consultado;
 * - querySphere: distância 3D até o centro da esfera.
 */
export interface SpatialQueryResult {
  readonly entityId: string;
  readonly distance: number;
  readonly position: WorldPosition3D;
}

/* ============================================================================
 * SCENE
 * ========================================================================== */

export type SceneAssetType =
  | "gltf"
  | "texture"
  | "audio";

export interface SceneAssetDescriptor {
  readonly id: string;
  readonly url: string;
  readonly type: SceneAssetType;
}

export interface SceneDescriptor {
  readonly sceneId: string;
  readonly sceneName: string;

  readonly assetsToPreload:
    ReadonlyArray<SceneAssetDescriptor>;

  readonly initialEntitiesCount?: number;
  readonly worldBounds?: AABBBounds3D;
}

export interface SceneLoadOptions {
  /**
   * Repassado em todo `game.world.scene-loading` (`showLoadingScreen`) para a
   * UI do jogo decidir se mostra a tela de loading. A engine não desenha UI.
   */
  readonly showLoadingScreen?: boolean;
  /** Padrão true: descarrega a cena anterior (emitindo entity-despawned). */
  readonly clearPreviousScene?: boolean;
  /**
   * true: ao terminar, inicia/retoma o `game.loop` (se a capability existir).
   */
  readonly autoStartLoop?: boolean;
  /**
   * true: falha de qualquer asset faz `loadScene` retornar false (a cena não
   * fica ativa). Padrão false: falhas são contadas em `failedAssets`.
   */
  readonly failOnAssetError?: boolean;
}

/* ============================================================================
 * ENTITY
 * ========================================================================== */

export interface EntityComponentState {
  readonly entityId: string;
  readonly type: string;

  readonly position:
    WorldPosition3D;

  readonly rotation:
    WorldRotation;

  readonly scale:
    WorldScale3D;

  readonly tags:
    ReadonlyArray<string>;

  readonly customData:
    Record<string, unknown>;
}

/**
 * Entrada de `spawnEntity`: só `entityId` é obrigatório.
 * Padrões: type "entity", position (0,0,0), rotation identidade,
 * scale (1,1,1), tags [], customData {}.
 */
export interface EntitySpawnInput {
  readonly entityId: string;
  readonly type?: string;
  readonly position?: Partial<WorldPosition3D>;
  readonly rotation?: WorldRotation;
  readonly scale?: Partial<WorldScale3D>;
  readonly tags?: ReadonlyArray<string>;
  readonly customData?: Record<string, unknown>;
}

/** Atualização parcial de transform (campos ausentes ficam como estão). */
export interface EntityTransformPatch {
  readonly position?: WorldPosition3D;
  readonly rotation?: WorldRotation;
  readonly scale?: WorldScale3D;
}

/** Atualização parcial de qualquer campo (exceto entityId). */
export interface EntityStatePatch
  extends EntityTransformPatch {
  readonly type?: string;
  readonly tags?: ReadonlyArray<string>;
  /** Substitui o customData inteiro (use spread para mesclar). */
  readonly customData?: Record<string, unknown>;
}

/* ============================================================================
 * EVENTOS DE MUNDO
 * ========================================================================== */

export interface SceneLoadingPayload {
  readonly sceneId: string;
  readonly progressPercentage: number;
  readonly statusMessage: string;
  /** Valor de `SceneLoadOptions.showLoadingScreen` (padrão false). */
  readonly showLoadingScreen: boolean;
}

export const SceneLoadingEvent =
  defineEvent<
    "game.world.scene-loading",
    SceneLoadingPayload
  >(
    "game.world.scene-loading",
  );

export interface SceneLoadedPayload {
  readonly sceneId: string;
  readonly loadTimeMs: number;
  readonly totalEntities: number;
  /** Assets pré-carregados com sucesso via `game.assets`. */
  readonly loadedAssets: number;
  /** URLs que falharam (ou todas, se `game.assets` não estiver disponível). */
  readonly failedAssets: ReadonlyArray<string>;
}

export interface SceneUnloadedPayload {
  readonly sceneId: string;
  readonly despawnedEntities: number;
}

export const SceneUnloadedEvent =
  defineEvent<
    "game.world.scene-unloaded",
    SceneUnloadedPayload
  >(
    "game.world.scene-unloaded",
  );

export interface WorldStateRestoredPayload {
  readonly sceneId: string | null;
  readonly totalEntities: number;
}

/** Emitido após `deserializeWorldState` bem-sucedido. */
export const WorldStateRestoredEvent =
  defineEvent<
    "game.world.state-restored",
    WorldStateRestoredPayload
  >(
    "game.world.state-restored",
  );

export const SceneLoadedEvent =
  defineEvent<
    "game.world.scene-loaded",
    SceneLoadedPayload
  >(
    "game.world.scene-loaded",
  );

export interface EntitySpawnedPayload {
  readonly entityId: string;
  readonly type: string;
  readonly position: WorldPosition3D;
}

export const EntitySpawnedEvent =
  defineEvent<
    "game.world.entity-spawned",
    EntitySpawnedPayload
  >(
    "game.world.entity-spawned",
  );

export interface EntityDespawnedPayload {
  readonly entityId: string;
}

export const EntityDespawnedEvent =
  defineEvent<
    "game.world.entity-despawned",
    EntityDespawnedPayload
  >(
    "game.world.entity-despawned",
  );

/* ============================================================================
 * COMANDOS DE MUNDO
 * ========================================================================== */

export interface LoadSceneRequest {
  readonly scene: SceneDescriptor;
  readonly options?: SceneLoadOptions;
}

export const LoadSceneCommand =
  defineCommand<
    "game.world.load-scene",
    LoadSceneRequest
  >(
    "game.world.load-scene",
  );

export interface UnloadSceneRequest {
  readonly sceneId: string;
}

export const UnloadSceneCommand =
  defineCommand<
    "game.world.unload-scene",
    UnloadSceneRequest
  >(
    "game.world.unload-scene",
  );

export interface SpawnEntityRequest {
  readonly state:
    EntitySpawnInput;
}

export const SpawnEntityCommand =
  defineCommand<
    "game.world.spawn-entity",
    SpawnEntityRequest
  >(
    "game.world.spawn-entity",
  );

export interface DespawnEntityRequest {
  readonly entityId: string;
}

export const DespawnEntityCommand =
  defineCommand<
    "game.world.despawn-entity",
    DespawnEntityRequest
  >(
    "game.world.despawn-entity",
  );

export interface UpdateEntityTransformRequest {
  readonly entityId: string;
  readonly patch:
    EntityTransformPatch;
}

export const UpdateEntityTransformCommand =
  defineCommand<
    "game.world.update-entity-transform",
    UpdateEntityTransformRequest
  >(
    "game.world.update-entity-transform",
  );
