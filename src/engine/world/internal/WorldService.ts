import type {
  PluginContext,
} from "@core";

import type {
  WorldApi,
} from "../../../tokens/world";

import type {
  AABBBounds3D,
  EntityComponentState,
  SceneDescriptor,
  SceneLoadOptions,
  SpatialPoint2D,
  SpatialQueryResult,
} from "../../../contracts/world/types";

import {
  EntityManager,
} from "./EntityManager";

import {
  SpatialGrid,
} from "./SpatialGrid";

import {
  OctreeManager,
} from "./OctreeManager";

import {
  SceneManager,
} from "./SceneManager";

import {
  WorldStateSerializer,
} from "./WorldStateSerializer";

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

  private readonly updateEntitySpatialIndexes =
    (
      entity:
        EntityComponentState,
    ): void => {
      this.spatialGrid.update(
        entity.entityId,
        entity.position,
      );

      this.octreeManager.update(
        entity.entityId,
        entity.position,
      );
    };

  private readonly insertEntitySpatialIndexes =
    (
      entity:
        EntityComponentState,
    ): void => {
      this.spatialGrid.insert(
        entity.entityId,
        entity.position,
      );

      this.octreeManager.insert(
        entity.entityId,
        entity.position,
      );
    };

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
    const loaded =
      await this.sceneManager
        .loadScene(
          scene,
          options,
        );

    if (loaded) {
      /*
       * SceneManager reseta os índices derivados. Reconstituímos
       * imediatamente para suportar clearPreviousScene=false sem
       * uma janela de consultas vazias até o próximo tick.
       */
      this.rebuildSpatialIndexes();
    }

    return loaded;
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

    const ownedState =
      this.entityManager
        .getEntityState(
          state.entityId,
        );

    if (!ownedState) {
      return false;
    }

    this.insertEntitySpatialIndexes(
      ownedState,
    );

    this.ctx.events.emit(
      "game.world.entity-spawned",
      {
        entityId:
          ownedState.entityId,

        type:
          ownedState.type,

        position:
          ownedState.position,
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

    this.octreeManager.remove(
      entityId,
    );

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
     * Persistência/backend e restauração do sceneId serão auditados
     * na Etapa 82. Nesta etapa os índices espaciais derivados do ECS
     * são reconstruídos de forma determinística após o restore.
     */
    this.rebuildSpatialIndexes();

    return true;
  }

  public tick(): void {
    /*
     * Não materializa Array.from() por frame.
     * O callback é criado uma única vez na instância do serviço.
     */
    this.entityManager
      .forEachEntity(
        this.updateEntitySpatialIndexes,
      );
  }

  public clear(): void {
    this.sceneManager.clear();
  }

  private rebuildSpatialIndexes():
    void {
    this.spatialGrid.clear();
    this.octreeManager.clear();

    this.entityManager
      .forEachEntity(
        this.insertEntitySpatialIndexes,
      );
  }
}
