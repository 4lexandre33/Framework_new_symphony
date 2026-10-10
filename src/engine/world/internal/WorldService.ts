import type {
  PluginContext,
} from "@core";

import type {
  WorldApi,
} from "../../../tokens/world";

import {
  AssetsToken,
  type AssetsApi,
} from "../../../tokens/assets";

import {
  GameLoopToken,
} from "../../../tokens/game-loop";

import type {
  AABBBounds3D,
  EntityComponentState,
  EntitySpawnInput,
  EntityStatePatch,
  EntityTransformPatch,
  SceneAssetDescriptor,
  SceneDescriptor,
  SceneLoadOptions,
  SpatialPoint2D,
  SpatialQueryResult,
  WorldPosition3D,
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
  type SceneAssetPort,
  type SceneLoopPort,
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
        {
          getAssets: (): SceneAssetPort | null =>
            this.resolveAssetPort(),
          getLoop: (): SceneLoopPort | null =>
            this.resolveLoopPort(),
        },
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
    state: EntitySpawnInput,
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

  public hasEntity(
    entityId: string,
  ): boolean {
    return this.entityManager
      .hasEntity(
        entityId,
      );
  }

  public updateEntityTransform(
    entityId: string,
    patch: EntityTransformPatch,
  ): boolean {
    const next =
      this.entityManager
        .updateTransform(
          entityId,
          patch,
        );

    if (next === null) {
      return false;
    }

    this.updateEntitySpatialIndexes(
      next,
    );

    return true;
  }

  public patchEntity(
    entityId: string,
    patch: EntityStatePatch,
  ): boolean {
    const next =
      this.entityManager
        .patchEntity(
          entityId,
          patch,
        );

    if (next === null) {
      return false;
    }

    this.updateEntitySpatialIndexes(
      next,
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

  public getAllEntities():
    EntityComponentState[] {
    return this.entityManager
      .getAllEntities();
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

  public querySphere(
    center: WorldPosition3D,
    radius: number,
  ): SpatialQueryResult[] {
    return this.octreeManager
      .querySphere(
        center,
        radius,
      );
  }

  public serializeWorldState():
    string {
    return WorldStateSerializer
      .serialize(
        this.currentSceneId,
        this.entityManager,
        this.sceneManager
          .currentWorldBounds,
      );
  }

  public deserializeWorldState(
    serializedData: string,
  ): boolean {
    // Valida tudo ANTES de tocar o estado atual.
    const snapshot =
      WorldStateSerializer
        .parse(
          serializedData,
        );

    if (snapshot === null) {
      console.error(
        "[WorldService] ❌ deserializeWorldState: snapshot inválido; estado atual preservado.",
      );

      return false;
    }

    const previousIds =
      this.entityManager
        .getEntityIds();

    this.entityManager.clear();

    for (
      const entity of
      snapshot.entities
    ) {
      this.entityManager.spawnEntity(
        entity,
      );
    }

    this.sceneManager.restoreScene(
      snapshot.sceneId,
      snapshot.worldBounds,
    );

    this.rebuildSpatialIndexes();

    for (
      const entityId of
      previousIds
    ) {
      this.ctx.events.emit(
        "game.world.entity-despawned",
        {
          entityId,
        },
      );
    }

    for (
      const entity of
      snapshot.entities
    ) {
      this.ctx.events.emit(
        "game.world.entity-spawned",
        {
          entityId:
            entity.entityId,

          type:
            entity.type,

          position:
            entity.position,
        },
      );
    }

    this.ctx.events.emit(
      "game.world.state-restored",
      {
        sceneId:
          snapshot.sceneId,

        totalEntities:
          snapshot.entities.length,
      },
    );

    return true;
  }

  public tick(): void {
    /*
     * Não materializa Array.from() por frame.
     * O callback é criado uma única vez na instância do serviço.
     * Os índices já são atualizados de forma imediata por
     * spawn/updateEntityTransform/patchEntity; esta passada mantém a
     * reconciliação defensiva por tick.
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

  /**
   * game.assets é opcional: sem ele a cena carrega sem pré-carregamento
   * (os assets aparecem em failedAssets).
   */
  private resolveAssetPort():
    SceneAssetPort | null {
    let assets:
      AssetsApi | undefined;

    try {
      assets =
        this.ctx.caps.get(
          AssetsToken,
        );
    } catch {
      return null;
    }

    if (assets === undefined) {
      return null;
    }

    return {
      async load(
        asset: SceneAssetDescriptor,
      ): Promise<void> {
        switch (asset.type) {
          case "gltf":
            await assets.loadGLTF(
              asset.url,
            );
            return;

          case "texture":
            await assets.loadTexture(
              asset.url,
            );
            return;

          case "audio":
            await assets.loadAudio(
              asset.url,
            );
            return;

          default:
            throw new RangeError(
              `tipo de asset desconhecido: ${String((asset as { type: unknown }).type)}`,
            );
        }
      },

      release(
        url: string,
      ): void {
        assets.releaseAsset(
          url,
        );
      },
    };
  }

  private resolveLoopPort():
    SceneLoopPort | null {
    try {
      return this.ctx.caps.get(
        GameLoopToken,
      ) ?? null;
    } catch {
      return null;
    }
  }
}
