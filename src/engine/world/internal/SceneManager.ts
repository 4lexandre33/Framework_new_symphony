import type { SceneDescriptor, SceneLoadOptions } from "../../../contracts/world/types";
import type { PluginContext } from "@core";
import { EntityManager } from "./EntityManager";
import { OctreeManager } from "./OctreeManager";
import { SpatialGrid } from "./SpatialGrid";

export class SceneManager {
  private activeSceneId: string | null = null;
  private isLoading = false;

  public constructor(
    private readonly ctx: PluginContext,
    private readonly entityManager: EntityManager,
    private readonly spatialGrid: SpatialGrid,
    private readonly octreeManager: OctreeManager
  ) {}

  public get currentSceneId(): string | null {
    return this.activeSceneId;
  }

  public async loadScene(scene: SceneDescriptor, options?: SceneLoadOptions): Promise<boolean> {
    if (this.isLoading) {
      console.warn(`[SceneManager] Transição de cena já em andamento. Ignorando solicitação para '${scene.sceneId}'.`);
      return false;
    }

    this.isLoading = true;
    const startTime = performance.now();

    this.ctx.events.emit("game.world.scene-loading", {
      sceneId: scene.sceneId,
      progressPercentage: 0,
      statusMessage: "Iniciando carregamento da cena...",
    });

    if (options?.clearPreviousScene !== false && this.activeSceneId) {
      await this.unloadScene(this.activeSceneId);
    }

    // 1. Pré-carregamento de Assets
    const totalAssets = scene.assetsToPreload.length;
    for (let i = 0; i < totalAssets; i++) {
      const asset = scene.assetsToPreload[i];
      const progress = Math.round(((i + 1) / (totalAssets || 1)) * 70);

      this.ctx.events.emit("game.world.scene-loading", {
        sceneId: scene.sceneId,
        progressPercentage: progress,
        statusMessage: `Carregando asset ${i + 1}/${totalAssets}: ${asset.id}`,
      });
    }

    // 2. Reinicialização de Particionamento Espacial
    if (scene.worldBounds) {
      this.octreeManager.resetBounds(scene.worldBounds);
    } else {
      this.octreeManager.resetBounds({
        min: { x: -500, y: -500, z: -500 },
        max: { x: 500, y: 500, z: 500 },
      });
    }
    this.spatialGrid.clear();

    this.activeSceneId = scene.sceneId;
    this.isLoading = false;

    const loadTimeMs = performance.now() - startTime;

    this.ctx.events.emit("game.world.scene-loading", {
      sceneId: scene.sceneId,
      progressPercentage: 100,
      statusMessage: "Cena carregada com sucesso!",
    });

    this.ctx.events.emit("game.world.scene-loaded", {
      sceneId: scene.sceneId,
      loadTimeMs,
      totalEntities: this.entityManager.activeEntityCount,
    });

    console.log(`[SceneManager] ✅ Cena '${scene.sceneId}' carregada em ${loadTimeMs.toFixed(2)}ms.`);
    return true;
  }

  public async unloadScene(sceneId: string): Promise<boolean> {
    if (this.activeSceneId !== sceneId) return false;

    console.log(`[SceneManager] 🧹 Descarregando cena '${sceneId}'...`);
    this.entityManager.clear();
    this.spatialGrid.clear();
    this.octreeManager.clear();
    this.activeSceneId = null;
    return true;
  }
}