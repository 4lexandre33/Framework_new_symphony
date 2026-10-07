import type {
  SceneDescriptor,
  SceneLoadOptions,
} from "../../../contracts/world/types";

import type {
  PluginContext,
} from "@core";

import {
  EntityManager,
} from "./EntityManager";

import {
  OctreeManager,
} from "./OctreeManager";

import {
  SpatialGrid,
} from "./SpatialGrid";

const DEFAULT_WORLD_MIN =
  -500;

const DEFAULT_WORLD_MAX =
  500;

export class SceneManager {
  private activeSceneId:
    string | null =
      null;

  private isLoading =
    false;

  public constructor(
    private readonly ctx:
      PluginContext,
    private readonly entityManager:
      EntityManager,
    private readonly spatialGrid:
      SpatialGrid,
    private readonly octreeManager:
      OctreeManager,
  ) {}

  public get currentSceneId():
    string | null {
    return this.activeSceneId;
  }

  public async loadScene(
    scene: SceneDescriptor,
    options?: SceneLoadOptions,
  ): Promise<boolean> {
    if (this.isLoading) {
      console.warn(
        `[SceneManager] Transição de cena já em andamento. Ignorando solicitação para '${scene.sceneId}'.`,
      );

      return false;
    }

    this.isLoading =
      true;

    const startTime =
      performance.now();

    try {
      this.ctx.events.emit(
        "game.world.scene-loading",
        {
          sceneId:
            scene.sceneId,

          progressPercentage:
            0,

          statusMessage:
            "Iniciando carregamento da cena...",
        },
      );

      if (
        options?.clearPreviousScene !==
          false &&
        this.activeSceneId
      ) {
        await this.unloadScene(
          this.activeSceneId,
        );
      }

      const totalAssets =
        scene.assetsToPreload.length;

      for (
        let index = 0;
        index < totalAssets;
        index += 1
      ) {
        const asset =
          scene.assetsToPreload[
            index
          ];

        if (!asset) {
          continue;
        }

        const progress =
          Math.round(
            (
              (
                index +
                1
              ) /
              (
                totalAssets ||
                1
              )
            ) *
              70,
          );

        this.ctx.events.emit(
          "game.world.scene-loading",
          {
            sceneId:
              scene.sceneId,

            progressPercentage:
              progress,

            statusMessage:
              `Carregando asset ${String(index + 1)}/${String(totalAssets)}: ${asset.id}`,
          },
        );
      }

      this.resetSpatialStructures(
        scene,
      );

      this.activeSceneId =
        scene.sceneId;

      const loadTimeMs =
        performance.now() -
        startTime;

      this.ctx.events.emit(
        "game.world.scene-loading",
        {
          sceneId:
            scene.sceneId,

          progressPercentage:
            100,

          statusMessage:
            "Cena carregada com sucesso!",
        },
      );

      this.ctx.events.emit(
        "game.world.scene-loaded",
        {
          sceneId:
            scene.sceneId,

          loadTimeMs,

          totalEntities:
            this.entityManager
              .activeEntityCount,
        },
      );

      console.log(
        `[SceneManager] ✅ Cena '${scene.sceneId}' carregada em ${loadTimeMs.toFixed(2)}ms.`,
      );

      return true;
    } finally {
      /*
       * Mesmo se um listener/event handler lançar durante o carregamento,
       * uma nova tentativa não fica bloqueada por isLoading=true órfão.
       */
      this.isLoading =
        false;
    }
  }

  public async unloadScene(
    sceneId: string,
  ): Promise<boolean> {
    if (
      this.activeSceneId !==
      sceneId
    ) {
      return false;
    }

    console.log(
      `[SceneManager] 🧹 Descarregando cena '${sceneId}'...`,
    );

    this.entityManager.clear();
    this.spatialGrid.clear();
    this.octreeManager.clear();
    this.activeSceneId = null;

    return true;
  }

  public clear(): void {
    this.entityManager.clear();
    this.spatialGrid.clear();
    this.octreeManager.clear();
    this.activeSceneId = null;
    this.isLoading = false;
  }

  private resetSpatialStructures(
    scene: SceneDescriptor,
  ): void {
    const bounds =
      scene.worldBounds ?? {
        min: {
          x:
            DEFAULT_WORLD_MIN,

          y:
            DEFAULT_WORLD_MIN,

          z:
            DEFAULT_WORLD_MIN,
        },

        max: {
          x:
            DEFAULT_WORLD_MAX,

          y:
            DEFAULT_WORLD_MAX,

          z:
            DEFAULT_WORLD_MAX,
        },
      };

    this.octreeManager
      .resetBounds(
        bounds,
      );

    this.spatialGrid.clear();
  }
}
