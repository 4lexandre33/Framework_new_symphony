import type { PluginContext } from "@core";
import { type WorldApi } from "../../../tokens/world";
import { type SceneDescriptor, type SceneLoadOptions, type EntityComponentState, type SpatialPoint2D, type SpatialQueryResult, type AABBBounds3D } from "../../../contracts/world/types";
import { EntityManager } from "./EntityManager";
import { SpatialGrid } from "./SpatialGrid";
import { OctreeManager } from "./OctreeManager";
import { SceneManager } from "./SceneManager";
import { WorldStateSerializer } from "./WorldStateSerializer";

export class WorldService
  implements WorldApi {
  private readonly entityManager =
    new EntityManager();

  private readonly spatialGrid =
    new SpatialGrid(
      16,
    );

  private readonly octreeManager =
    new OctreeManager();

  private readonly sceneManager:
    SceneManager;

  public constructor(
    private readonly ctx:
      PluginContext,
  ) {
    this.sceneManager =
      new SceneManager(
        ctx,
        this.entityManager,
        this.spatialGrid,
        this.octreeManager,
      );
  }

  public get currentSceneId():
    string | null {
    return this.sceneManager
      .currentSceneId;
  }

  public get activeEntityCount():
    number {
    return this.entityManager
      .activeEntityCount;
  }

  public async loadScene(
    scene: SceneDescriptor,
    options?: SceneLoadOptions,
  ): Promise<boolean> {
    return await this.sceneManager
      .loadScene(
        scene,
        options,
      );
  }

  public async unloadScene(
    sceneId: string,
  ): Promise<boolean> {
    return await this.sceneManager
      .unloadScene(
        sceneId,
      );
  }

  public spawnEntity(
    state: EntityComponentState,
  ): boolean {
    const spawned =
      this.entityManager
        .spawnEntity(
          state,
        );

    if (!spawned) {
      return false;
    }

    this.spatialGrid.insert(
      state.entityId,
      state.position,
    );

    this.octreeManager.insert(
      state.entityId,
      state.position,
    );

    this.ctx.events.emit(
      "game.world.entity-spawned",
      {
        entityId:
          state.entityId,

        type:
          state.type,

        position:
          state.position,
      },
    );

    return true;
  }

  public despawnEntity(
    entityId: string,
  ): boolean {
    const despawned =
      this.entityManager
        .despawnEntity(
          entityId,
        );

    if (!despawned) {
      return false;
    }

    this.spatialGrid.remove(
      entityId,
    );

    /*
     * O OctreeManager atual não possui remove(entityId).
     *
     * Recriamos o índice 3D após um despawn para impedir
     * que consultas futuras retornem uma entidade destruída.
     *
     * Despawn é uma operação muito menos frequente que tick,
     * então este custo é aceitável até o Octree possuir
     * atualização incremental.
     */
    this.rebuildOctree();

    this.ctx.events.emit(
      "game.world.entity-despawned",
      {
        entityId,
      },
    );

    return true;
  }

  public getEntityState(
    entityId: string,
  ): EntityComponentState | null {
    return this.entityManager
      .getEntityState(
        entityId,
      );
  }

  public querySpatialGrid(
    center: SpatialPoint2D,
    radius: number,
  ): SpatialQueryResult[] {
    return this.spatialGrid
      .queryRadius(
        center,
        radius,
      );
  }

  public queryOctree(
    bounds: AABBBounds3D,
  ): SpatialQueryResult[] {
    return this.octreeManager
      .queryBounds(
        bounds,
      );
  }

  public serializeWorldState():
    string {
    return WorldStateSerializer
      .serialize(
        this.currentSceneId,
        this.entityManager,
      );
  }

  public deserializeWorldState(
    serializedData: string,
  ): boolean {
    const restored =
      WorldStateSerializer
        .deserialize(
          serializedData,
          this.entityManager,
        );

    if (!restored) {
      return false;
    }

    /*
     * O serializer restaura o ECS.
     *
     * Os índices espaciais são derivados do ECS
     * e precisam ser reconstruídos depois do load.
     */
    this.rebuildSpatialIndexes();

    return true;
  }

  public tick(): void {
    const entities =
      this.entityManager
        .getAllEntities();

    for (
      let index = 0;
      index <
      entities.length;
      index += 1
    ) {
      const entity =
        entities[index];

      if (!entity) {
        continue;
      }

      this.spatialGrid.insert(
        entity.entityId,
        entity.position,
      );
    }
  }

  public clear(): void {
    this.entityManager.clear();
    this.spatialGrid.clear();
    this.octreeManager.clear();
  }

  private rebuildSpatialIndexes():
    void {
    this.spatialGrid.clear();
    this.octreeManager.clear();

    const entities =
      this.entityManager
        .getAllEntities();

    for (
      let index = 0;
      index <
      entities.length;
      index += 1
    ) {
      const entity =
        entities[index];

      if (!entity) {
        continue;
      }

      this.spatialGrid.insert(
        entity.entityId,
        entity.position,
      );

      this.octreeManager.insert(
        entity.entityId,
        entity.position,
      );
    }
  }

  private rebuildOctree():
    void {
    this.octreeManager.clear();

    const entities =
      this.entityManager
        .getAllEntities();

    for (
      let index = 0;
      index <
      entities.length;
      index += 1
    ) {
      const entity =
        entities[index];

      if (!entity) {
        continue;
      }

      this.octreeManager.insert(
        entity.entityId,
        entity.position,
      );
    }
  }
}
