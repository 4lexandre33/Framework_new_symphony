import {
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  DistanceLODManager,
} from "../src/engine/streaming/internal/DistanceLODManager";

import {
  WorldStreamingSectorManager,
} from "../src/engine/streaming/internal/WorldStreamingSectorManager";

import {
  HLODBuilder,
} from "../src/engine/streaming/internal/HLODBuilder";

import {
  StreamingWorkerPool,
} from "../src/engine/streaming/internal/StreamingWorkerPool";

import {
  createStreamingPlugin,
} from "../src/plugins/streaming/plugin";

import {
  CameraToken,
} from "../src/tokens/camera";

import {
  StreamingToken,
} from "../src/tokens/streaming";

import {
  SetStreamingRadiusCommand,
} from "../src/contracts/streaming/types";

describe("Camada de Streaming & LOD (game.streaming)", (): void => {
  let lodManager: DistanceLODManager;
  let sectorManager: WorldStreamingSectorManager;
  let hlodBuilder: HLODBuilder;
  let workerPool: StreamingWorkerPool;

  beforeEach((): void => {
    lodManager = new DistanceLODManager();
    sectorManager = new WorldStreamingSectorManager();
    hlodBuilder = new HLODBuilder();
    workerPool = new StreamingWorkerPool(0);
  });

  describe("DistanceLODManager", (): void => {
    it("deve alternar níveis de LOD pela distância da câmera", (): void => {
      lodManager.registerEntity({
        entityId: "tree_01",
        worldPosition: { x: 0, y: 0, z: 0 },
        currentLevel: 0,
        lodLevels: [
          { level: 0, distanceThreshold: 0, meshUrl: "tree_high.glb" },
          { level: 1, distanceThreshold: 20, meshUrl: "tree_med.glb" },
          { level: 2, distanceThreshold: 50, meshUrl: "tree_low.glb" },
        ],
      });

      lodManager.updateLODs({ x: 10, y: 0, z: 0 }, (): void => {});
      expect(lodManager.getEntityLOD("tree_01")).toBe(0);

      let changed = false;
      lodManager.updateLODs(
        { x: 30, y: 0, z: 0 },
        (entityId, _previousLevel, nextLevel): void => {
          if (entityId === "tree_01" && nextLevel === 1) {
            changed = true;
          }
        },
      );

      expect(changed).toBe(true);
      expect(lodManager.getEntityLOD("tree_01")).toBe(1);
    });
  });

  describe("WorldStreamingSectorManager", (): void => {
    it("deve solicitar carregamento dentro do raio", (): void => {
      sectorManager.setStreamingRadius(50, 10);
      sectorManager.registerSector({
        sectorCoord: { x: 0, y: 0, z: 0 },
        boundsMin: { x: -25, y: -25, z: -25 },
        boundsMax: { x: 25, y: 25, z: 25 },
        assetUrls: ["building_01.glb"],
      });

      let loadRequested = false;

      sectorManager.updateStreamingSectors(
        { x: 0, y: 0, z: 0 },
        (): void => {
          loadRequested = true;
        },
        (): void => {},
      );

      expect(loadRequested).toBe(true);
      expect(sectorManager.getSectorState({ x: 0, y: 0, z: 0 })).toBe("loading");
    });

    it("não deve criar estado para setor inexistente", (): void => {
      expect(
        sectorManager.setSectorState(
          { x: 99, y: 0, z: 99 },
          "loaded",
        ),
      ).toBe(false);
    });
  });

  describe("HLODBuilder", (): void => {
    it("deve calcular economia de draw calls", (): void => {
      hlodBuilder.registerCluster({
        clusterId: "cluster_village",
        sectorCoord: { x: 1, y: 0, z: 1 },
        staticMeshUrls: ["house1.glb", "house2.glb", "fence.glb", "well.glb"],
        combinedMeshUrl: "village_hlod.glb",
        boundingCenter: { x: 50, y: 0, z: 50 },
        boundingRadius: 30,
      });

      const stats = hlodBuilder.getStats();
      expect(stats.totalClusters).toBe(1);
      expect(stats.drawCallsSaved).toBe(3);
    });
  });

  describe("StreamingWorkerPool", (): void => {
    it("deve respeitar maxWorkers=0 e usar fallback síncrono", async (): Promise<void> => {
      expect(workerPool.workerCount).toBe(0);

      const sectors = [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 10 },
      ];

      const visible = await workerPool.processVisibilityAsync(
        { x: 0, y: 0, z: 0 },
        sectors,
        100,
      );

      expect(visible).toEqual([{ x: 0, y: 0, z: 0 }]);
    });

    it("deve liberar recursos sem deixar workers ocupados", (): void => {
      workerPool.clear();
      expect(workerPool.workerCount).toBe(0);
      expect(workerPool.busyWorkerCount).toBe(0);
    });
  });

  describe("Plugin game.streaming", (): void => {
    it("deve consumir camera, depender do loop e registrar comando de raio", (): void => {
      const plugin = createStreamingPlugin();
      const provides = plugin.manifest.capabilities?.provides ?? [];
      const consumes = plugin.manifest.capabilities?.consumes ?? [];

      expect(provides.some((item): boolean => item.id === StreamingToken.id)).toBe(true);
      expect(consumes.some((item): boolean => item.id === CameraToken.id)).toBe(true);
      expect(
        plugin.manifest.dependsOn?.some((item): boolean => item.id === "game.loop"),
      ).toBe(true);
      expect(SetStreamingRadiusCommand.type).toBe("game.streaming.set-radius");
    });
  });
});
