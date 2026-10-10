import type {
  AABBBounds3D,
  SceneAssetDescriptor,
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

/** Porta de pré-carregamento de assets (implementada sobre game.assets). */
export interface SceneAssetPort {
  load(
    asset: SceneAssetDescriptor,
  ): Promise<void>;
  release(
    url: string,
  ): void;
}

/** Porta mínima do game.loop usada por `autoStartLoop`. */
export interface SceneLoopPort {
  start(): void;
  resume(): void;
}

export interface SceneManagerPorts {
  readonly getAssets?: () => SceneAssetPort | null;
  readonly getLoop?: () => SceneLoopPort | null;
}

function describeError(
  error: unknown,
): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

export class SceneManager {
  private activeSceneId:
    string | null =
      null;

  private activeWorldBounds:
    AABBBounds3D | null =
      null;

  /** URLs pré-carregadas pela cena ativa (liberadas no unload). */
  private sceneAssetUrls:
    string[] = [];

  private sceneAssetPort:
    SceneAssetPort | null =
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
    private readonly ports:
      SceneManagerPorts = {},
  ) {}

  public get currentSceneId():
    string | null {
    return this.activeSceneId;
  }

  public get currentWorldBounds():
    AABBBounds3D | null {
    return this.activeWorldBounds;
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

    const showLoadingScreen =
      options?.showLoadingScreen ===
      true;

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

          showLoadingScreen,
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

      const assets =
        Array.isArray(
          scene.assetsToPreload,
        )
          ? scene.assetsToPreload
          : [];

      const assetPort =
        assets.length > 0
          ? this.ports.getAssets?.() ?? null
          : null;

      const loadedUrls:
        string[] = [];

      const failedAssets:
        string[] = [];

      if (
        assets.length > 0 &&
        assetPort === null
      ) {
        for (const asset of assets) {
          failedAssets.push(
            asset.url,
          );
        }

        console.warn(
          `[SceneManager] game.assets indisponível: ${String(assets.length)} asset(s) da cena '${scene.sceneId}' não foram pré-carregados.`,
        );
      }

      if (assetPort !== null) {
        let completed = 0;

        // Carga paralela; o progresso avança conforme cada asset conclui.
        await Promise.all(
          assets.map(
            async (
              asset,
            ): Promise<void> => {
              let statusMessage: string;

              try {
                await assetPort.load(
                  asset,
                );

                loadedUrls.push(
                  asset.url,
                );

                statusMessage =
                  `Asset carregado: ${asset.id}`;
              } catch (error) {
                failedAssets.push(
                  asset.url,
                );

                statusMessage =
                  `Falha no asset ${asset.id}: ${describeError(error)}`;
              }

              completed += 1;

              this.ctx.events.emit(
                "game.world.scene-loading",
                {
                  sceneId:
                    scene.sceneId,

                  progressPercentage:
                    Math.round(
                      (completed / assets.length) *
                        90,
                    ),

                  statusMessage:
                    `${statusMessage} (${String(completed)}/${String(assets.length)})`,

                  showLoadingScreen,
                },
              );
            },
          ),
        );
      }

      if (
        options?.failOnAssetError ===
          true &&
        failedAssets.length > 0
      ) {
        if (assetPort !== null) {
          for (const url of loadedUrls) {
            assetPort.release(
              url,
            );
          }
        }

        console.error(
          `[SceneManager] ❌ Cena '${scene.sceneId}' abortada: ${String(failedAssets.length)} asset(s) falharam.`,
        );

        return false;
      }

      this.resetSpatialStructures(
        scene,
      );

      this.activeSceneId =
        scene.sceneId;

      this.sceneAssetUrls =
        loadedUrls;

      this.sceneAssetPort =
        assetPort;

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

          showLoadingScreen,
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

          loadedAssets:
            loadedUrls.length,

          failedAssets,
        },
      );

      if (
        options?.autoStartLoop ===
        true
      ) {
        const loop =
          this.ports.getLoop?.() ?? null;

        if (loop !== null) {
          loop.start();
          loop.resume();
        }
      }

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

    const despawnedIds =
      this.entityManager
        .getEntityIds();

    this.entityManager.clear();
    this.spatialGrid.clear();
    this.octreeManager.clear();
    this.activeSceneId = null;
    this.activeWorldBounds = null;
    this.releaseSceneAssets();

    for (const entityId of despawnedIds) {
      this.ctx.events.emit(
        "game.world.entity-despawned",
        {
          entityId,
        },
      );
    }

    this.ctx.events.emit(
      "game.world.scene-unloaded",
      {
        sceneId,
        despawnedEntities:
          despawnedIds.length,
      },
    );

    return true;
  }

  /**
   * Restaura o sceneId (e os limites) de um snapshot sem recarregar assets.
   */
  public restoreScene(
    sceneId: string | null,
    worldBounds: AABBBounds3D | null,
  ): void {
    this.activeSceneId =
      sceneId;

    this.activeWorldBounds =
      worldBounds;

    this.octreeManager
      .resetBounds(
        worldBounds ??
          this.createDefaultBounds(),
      );
  }

  /** Teardown: sem eventos (o barramento está sendo desligado). */
  public clear(): void {
    this.entityManager.clear();
    this.spatialGrid.clear();
    this.octreeManager.clear();
    this.activeSceneId = null;
    this.activeWorldBounds = null;
    this.releaseSceneAssets();
    this.isLoading = false;
  }

  private releaseSceneAssets(): void {
    const port =
      this.sceneAssetPort;

    const urls =
      this.sceneAssetUrls;

    this.sceneAssetPort =
      null;

    this.sceneAssetUrls =
      [];

    if (port === null) {
      return;
    }

    for (const url of urls) {
      try {
        port.release(
          url,
        );
      } catch (error) {
        console.warn(
          `[SceneManager] Falha ao liberar asset '${url}': ${describeError(error)}`,
        );
      }
    }
  }

  private createDefaultBounds():
    AABBBounds3D {
    return {
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
  }

  private resetSpatialStructures(
    scene: SceneDescriptor,
  ): void {
    this.activeWorldBounds =
      scene.worldBounds ?? null;

    this.octreeManager
      .resetBounds(
        scene.worldBounds ??
          this.createDefaultBounds(),
      );

    this.spatialGrid.clear();
  }
}
