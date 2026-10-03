import {
  defineCapability,
} from "../core/contracts/capability-token";

import type {
  AABBBounds3D,
  EntityComponentState,
  SceneDescriptor,
  SceneLoadOptions,
  SpatialPoint2D,
  SpatialQueryResult,
} from "../contracts/world/types";

export interface WorldApi {
  readonly currentSceneId:
    string | null;

  readonly activeEntityCount:
    number;

  loadScene(
    scene: SceneDescriptor,
    options?: SceneLoadOptions,
  ): Promise<boolean>;

  unloadScene(
    sceneId: string,
  ): Promise<boolean>;

  spawnEntity(
    state: EntityComponentState,
  ): boolean;

  despawnEntity(
    entityId: string,
  ): boolean;

  getEntityState(
    entityId: string,
  ): EntityComponentState | null;

  querySpatialGrid(
    center: SpatialPoint2D,
    radius: number,
  ): SpatialQueryResult[];

  queryOctree(
    bounds: AABBBounds3D,
  ): SpatialQueryResult[];

  serializeWorldState():
    string;

  deserializeWorldState(
    serializedData: string,
  ): boolean;
}

export const WorldToken =
  defineCapability<WorldApi>(
    "game.world",
    "1.0.0",
  );