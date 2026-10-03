import type {
  Plugin,
  PluginContext,
} from "../../core/contracts/plugin-context";

import {
  WorldToken,
  type WorldApi,
} from "../../tokens/world";

import {
  SceneLoadingEvent,
  SceneLoadedEvent,
  EntitySpawnedEvent,
  EntityDespawnedEvent,
  LoadSceneCommand,
  UnloadSceneCommand,
  SpawnEntityCommand,
  DespawnEntityCommand,
  type SceneDescriptor,
  type SceneLoadOptions,
  type EntityComponentState,
  type SpatialPoint2D,
  type SpatialQueryResult,
  type AABBBounds3D,
} from "../../contracts/world/types";

import {
  EntityManager,
} from "../../engine/world/EntityManager";

import {
  SpatialGrid,
} from "../../engine/world/SpatialGrid";

import {
  OctreeManager,
} from "../../engine/world/OctreeManager";

import {
  SceneManager,
} from "../../engine/world/SceneManager";

import {
  WorldStateSerializer,
} from "../../engine/world/WorldStateSerializer";

export const worldManifest:
  Plugin["manifest"] = {
    id:
      "game.world",

    name:
      "Scene Manager, World State & ECS Plugin",

    version:
      "1.0.0",

    kind:
      "preloaded",

    authority:
      "game",

    permissions: {
      capabilities: [
        WorldToken.id,
      ],

      events: [
        "game.world.scene-loading",
        "game.world.scene-loaded",
        "game.world.entity-spawned",
        "game.world.entity-despawned",
        "game.loop.tick",
        "game.loop.render",
      ],
    },

    capabilities: {
      provides: [
        {
          id:
            WorldToken.id,

          version:
            "1.0.0",
        },
      ],
    },
  };

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

export function createWorldPlugin():
  Plugin {
  return {
    manifest:
      worldManifest,

    setup(
      ctx: PluginContext,
    ): void {
      const worldService =
        new WorldService(
          ctx,
        );

      ctx.caps.provide(
        WorldToken,
        worldService,
      );

      ctx.events.define(
        SceneLoadingEvent,
      );

      ctx.events.define(
        SceneLoadedEvent,
      );

      ctx.events.define(
        EntitySpawnedEvent,
      );

      ctx.events.define(
        EntityDespawnedEvent,
      );

      ctx.commands.define(
        LoadSceneCommand,
      );

      ctx.commands.define(
        UnloadSceneCommand,
      );

      ctx.commands.define(
        SpawnEntityCommand,
      );

      ctx.commands.define(
        DespawnEntityCommand,
      );

      const unbindTick =
        ctx.events.on(
          "game.loop.tick",
          (): void => {
            worldService.tick();
          },
        );

      const unbindLoad =
        ctx.commands.handle(
          "game.world.load-scene",
          async (
            env,
          ) => {
            const payload =
              env.payload as {
                scene:
                  SceneDescriptor;

                options?:
                  SceneLoadOptions;
              };

            return await worldService
              .loadScene(
                payload.scene,
                payload.options,
              );
          },
        );

      const unbindUnload =
        ctx.commands.handle(
          "game.world.unload-scene",
          async (
            env,
          ) => {
            const payload =
              env.payload as {
                sceneId:
                  string;
              };

            return await worldService
              .unloadScene(
                payload.sceneId,
              );
          },
        );

      const unbindSpawn =
        ctx.commands.handle(
          "game.world.spawn-entity",
          (
            env,
          ) => {
            const payload =
              env.payload as {
                state:
                  EntityComponentState;
              };

            return worldService
              .spawnEntity(
                payload.state,
              );
          },
        );

      const unbindDespawn =
        ctx.commands.handle(
          "game.world.despawn-entity",
          (
            env,
          ) => {
            const payload =
              env.payload as {
                entityId:
                  string;
              };

            return worldService
              .despawnEntity(
                payload.entityId,
              );
          },
        );

      ctx.lifecycle.onDispose(
        (): void => {
          unbindTick();
          unbindLoad();
          unbindUnload();
          unbindSpawn();
          unbindDespawn();

          worldService.clear();
        },
      );

      ctx.lifecycle.ready();
    },
  };
}