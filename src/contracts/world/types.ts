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
  readonly showLoadingScreen?: boolean;
  readonly clearPreviousScene?: boolean;
  readonly autoStartLoop?: boolean;
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

/* ============================================================================
 * EVENTOS DE MUNDO
 * ========================================================================== */

export interface SceneLoadingPayload {
  readonly sceneId: string;
  readonly progressPercentage: number;
  readonly statusMessage: string;
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
}

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
    EntityComponentState;
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