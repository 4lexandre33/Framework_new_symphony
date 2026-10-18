// @vitest-environment node

import { describe, expect, it } from "vitest";
import * as THREE from "three";

import type { PluginContext } from "@core";

import type { StreamingSectorDescriptor } from "../src/contracts/streaming/types";
import { StreamingService } from "../src/engine/streaming/internal/StreamingService";
import { isLikelyAssetUrl } from "../src/engine/streaming/internal/DistanceLODManager";
import { createStreamingPlugin } from "../src/plugins/streaming/plugin";
import type { AssetsApi } from "../src/tokens/assets";
import type { CameraApi } from "../src/tokens/camera";
import type { Render3DApi } from "../src/tokens/render";
import { AssetsToken } from "../src/tokens/assets";
import { CameraToken } from "../src/tokens/camera";
import { RenderToken } from "../src/tokens/render";

interface Emitted {
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

function createService(): { service: StreamingService; emitted: Emitted[] } {
  const emitted: Emitted[] = [];
  const ctx = {
    events: {
      emit(type: string, payload: Record<string, unknown>): void {
        emitted.push({ type, payload });
      },
    },
  } as unknown as PluginContext;
  return { service: new StreamingService(ctx), emitted };
}

function sector(x: number, z: number, assetUrls: string[] = [], extra: Partial<StreamingSectorDescriptor> = {}): StreamingSectorDescriptor {
  return {
    sectorCoord: { x, y: 0, z },
    boundsMin: { x: x * 50 - 25, y: -5, z: z * 50 - 25 },
    boundsMax: { x: x * 50 + 25, y: 5, z: z * 50 + 25 },
    assetUrls,
    ...extra,
  };
}

interface FakeAssets {
  readonly api: AssetsApi;
  readonly refs: Map<string, number>;
  readonly order: string[];
  resolveAll(): Promise<void>;
}

function createAssets(options: { failing?: string[]; deferred?: boolean } = {}): FakeAssets {
  const refs = new Map<string, number>();
  const order: string[] = [];
  const pending: Array<() => void> = [];
  const load = (url: string): Promise<unknown> => {
    order.push(url);
    const run = (resolve: (value: unknown) => void, reject: (reason: unknown) => void): void => {
      if (options.failing?.includes(url)) {
        reject(new Error("404"));
        return;
      }

      refs.set(url, (refs.get(url) ?? 0) + 1);
      resolve({ url, scene: new THREE.Group() });
    };

    return new Promise((resolve, reject) => {
      if (options.deferred) {
        pending.push(() => run(resolve, reject));
      } else {
        run(resolve, reject);
      }
    });
  };
  const api = {
    loadGLTF: load,
    loadTexture: load,
    loadAudio: load,
    loadJSON: load,
    loadBinary: load,
    releaseAsset(url: string): void {
      const count = refs.get(url) ?? 0;

      if (count <= 1) {
        refs.delete(url);
      } else {
        refs.set(url, count - 1);
      }
    },
  } as unknown as AssetsApi;
  return {
    api,
    refs,
    order,
    async resolveAll(): Promise<void> {
      while (pending.length > 0) {
        pending.shift()!();
        await flush();
      }
    },
  };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function createRender(): { api: Render3DApi; scene: Map<string, THREE.Object3D> } {
  const scene = new Map<string, THREE.Object3D>();
  const api = {
    addMeshToScene(key: string, object: THREE.Object3D): void {
      scene.set(key, object);
    },
    removeMeshFromScene(key: string): void {
      scene.delete(key);
    },
    getMeshFromScene(key: string): THREE.Object3D | null {
      return scene.get(key) ?? null;
    },
  } as unknown as Render3DApi;
  return { api, scene };
}

describe("streaming gaps — G17 centro e assets", () => {
  it("updateStreamingCenter passa a origem para explícita (a câmera não sobrescreve); setCenterSource volta", () => {
    const { service } = createService();
    const camera = { getCurrentCameraSnapshot: () => ({ position: { x: 999, y: 0, z: 999 } }) } as unknown as CameraApi;
    service.bindDependencies({ camera });
    service.updateFromBoundCamera(0.016);
    expect(service.getStreamingCenter()).toEqual({ x: 999, y: 0, z: 999 });
    service.updateStreamingCenter({ x: 1, y: 2, z: 3 });
    service.updateFromBoundCamera(0.016);
    expect(service.getStreamingCenter()).toEqual({ x: 1, y: 2, z: 3 });
    expect(service.getStats().centerSource).toBe("explicit");
    service.setCenterSource("camera");
    service.updateFromBoundCamera(0.016);
    expect(service.getStreamingCenter()).toEqual({ x: 999, y: 0, z: 999 });
  });

  it("assetUrls são carregados via game.assets antes de sector-loaded e liberados no unload", async () => {
    const { service, emitted } = createService();
    const assets = createAssets({ failing: ["missing.png"] });
    service.bindDependencies({ assets: assets.api });
    service.registerSector(sector(0, 0, ["house.glb", "grass.png", "missing.png"]));
    await expect(service.loadSector({ x: 0, y: 0, z: 0 })).resolves.toBe(true);
    const loaded = emitted.find((e) => e.type === "game.streaming.sector-loaded");
    expect(loaded?.payload).toMatchObject({ loadedAssetsCount: 2, failedAssetsCount: 1, pinned: true });
    expect(assets.refs.get("house.glb")).toBe(1);
    expect(service.getSectorAsset({ x: 0, y: 0, z: 0 }, "house.glb")).toMatchObject({ url: "house.glb" });
    expect(service.unloadSector({ x: 0, y: 0, z: 0 })).toBe(true);
    expect(assets.refs.size).toBe(0);
    expect(emitted.filter((e) => e.type === "game.streaming.sector-unloaded")).toHaveLength(1);
  });

  it("meshUrl do nível de LOD é pré-carregado e o anterior liberado", async () => {
    const { service, emitted } = createService();
    const assets = createAssets();
    service.bindDependencies({ assets: assets.api });
    service.updateStreamingCenter({ x: 0, y: 0, z: 0 });
    service.registerLODEntity({
      entityId: "tree",
      worldPosition: { x: 0, y: 0, z: 0 },
      currentLevel: 0,
      lodLevels: [
        { level: 0, distanceThreshold: 0, meshUrl: "tree_hi.glb" },
        { level: 1, distanceThreshold: 30, meshUrl: "tree_lo.glb" },
      ],
    });
    await flush();
    expect(assets.refs.get("tree_hi.glb")).toBe(1);
    service.update({ x: 100, y: 0, z: 0 }, 0.016);
    await flush();
    expect(assets.refs.get("tree_lo.glb")).toBe(1);
    expect(assets.refs.has("tree_hi.glb")).toBe(false);
    expect(emitted.find((e) => e.type === "game.streaming.lod-changed")?.payload).toMatchObject({ newLevel: 1, meshUrl: "tree_lo.glb" });
    service.unregisterLODEntity("tree");
    expect(assets.refs.size).toBe(0);
  });

  it("G132: chave que não é URL não carrega; preload força/desliga", async () => {
    const { service, emitted } = createService();
    const assets = createAssets();
    service.bindDependencies({ assets: assets.api });
    service.updateStreamingCenter({ x: 0, y: 0, z: 0 });
    service.registerLODEntity({
      entityId: "rock",
      worldPosition: { x: 0, y: 0, z: 0 },
      currentLevel: 0,
      lodLevels: [
        { level: 0, distanceThreshold: 0, meshUrl: "rock-high" },
        { level: 1, distanceThreshold: 30, meshUrl: "rock-low", preload: true },
        { level: 2, distanceThreshold: 60, meshUrl: "rock_far.glb", preload: false },
      ],
    });
    await flush();
    expect(assets.order).toEqual([]);
    service.update({ x: 40, y: 0, z: 0 }, 0.016);
    await flush();
    expect(assets.order).toEqual(["rock-low"]);
    service.update({ x: 100, y: 0, z: 0 }, 0.016);
    await flush();
    expect(assets.order).toEqual(["rock-low"]);
    expect(assets.refs.size).toBe(0);
    expect(service.getStats().assetsFailed ?? 0).toBe(0);
    const changes = emitted.filter((e) => e.type === "game.streaming.lod-changed").map((e) => e.payload.meshUrl);
    expect(changes).toEqual(["rock-low", "rock_far.glb"]);
    service.unregisterLODEntity("rock");
  });

  it("G132: heurística de URL", () => {
    for (const url of ["tree.glb", "/models/a", "./a", "../b", "https://x/y", "blob:abc", "models/tree.gltf?v=2"]) {
      expect(isLikelyAssetUrl(url), url).toBe(true);
    }

    for (const key of ["", "tree-low", "rock_2", "lod:far", "models/tree"]) {
      expect(isLikelyAssetUrl(key), key).toBe(false);
    }
  });
});

describe("streaming gaps — G60 manual respeitado", () => {
  it("loadSector fixa (o raio não descarrega); unloadSector suprime até sair do raio; releaseSector devolve ao raio", async () => {
    const { service, emitted } = createService();
    service.setStreamingRadius(60, 10);
    service.registerSector(sector(0, 0));
    service.registerSector(sector(10, 0)); // longe (x=500)
    service.update({ x: 0, y: 0, z: 0 }, 0.2);
    expect(service.getSectorState({ x: 0, y: 0, z: 0 })).toBe("loaded");
    expect(service.isSectorPinned({ x: 0, y: 0, z: 0 })).toBe(false);

    // Manual longe: carregado e mantido apesar do raio.
    await expect(service.loadSector({ x: 10, y: 0, z: 0 })).resolves.toBe(true);
    service.update({ x: 0, y: 0, z: 0 }, 0.2);
    service.update({ x: 0, y: 0, z: 0 }, 0.2);
    expect(service.getSectorState({ x: 10, y: 0, z: 0 })).toBe("loaded");

    // Descarga manual dentro do raio: não volta sozinho.
    service.unloadSector({ x: 0, y: 0, z: 0 });
    service.update({ x: 0, y: 0, z: 0 }, 0.2);
    expect(service.getSectorState({ x: 0, y: 0, z: 0 })).toBe("unloaded");
    // Sai do raio e volta: regra de raio reassume.
    service.update({ x: 1000, y: 0, z: 0 }, 0.2);
    service.update({ x: 0, y: 0, z: 0 }, 0.2);
    expect(service.getSectorState({ x: 0, y: 0, z: 0 })).toBe("loaded");

    // releaseSector: o fixo longe passa a obedecer o raio.
    expect(service.releaseSector({ x: 10, y: 0, z: 0 })).toBe(true);
    service.update({ x: 0, y: 0, z: 0 }, 0.2);
    expect(service.getSectorState({ x: 10, y: 0, z: 0 })).toBe("unloaded");
    expect(emitted.filter((e) => e.type === "game.streaming.sector-unloaded").length).toBeGreaterThanOrEqual(2);
  });

  it("prioridade e concorrência de cargas", async () => {
    const { service } = createService();
    const assets = createAssets({ deferred: true });
    service.bindDependencies({ assets: assets.api });
    service.setMaxConcurrentLoads(1);
    service.registerSector(sector(0, 0, ["a.bin"]));
    service.registerSector(sector(1, 0, ["b.bin"]));
    service.registerSector(sector(2, 0, ["c.bin"]));
    const first = service.loadSector({ x: 0, y: 0, z: 0 }, 0);
    const low = service.loadSector({ x: 1, y: 0, z: 0 }, 1);
    const high = service.loadSector({ x: 2, y: 0, z: 0 }, 10);
    expect(service.getStats().queuedSectors).toBe(2);
    await assets.resolveAll();
    await Promise.all([first, low, high]);
    expect(assets.order).toEqual(["a.bin", "c.bin", "b.bin"]);
    expect(service.getStats().averageLoadTimeMs).toBeGreaterThanOrEqual(0);
  });

  it("descarga durante a carga cancela e devolve os assets", async () => {
    const { service, emitted } = createService();
    const assets = createAssets({ deferred: true });
    service.bindDependencies({ assets: assets.api });
    service.registerSector(sector(0, 0, ["a.glb"]));
    const promise = service.loadSector({ x: 0, y: 0, z: 0 });
    service.unloadSector({ x: 0, y: 0, z: 0 });
    await expect(promise).resolves.toBe(false);
    await assets.resolveAll();
    expect(assets.refs.size).toBe(0);
    expect(emitted.some((e) => e.type === "game.streaming.sector-loaded")).toBe(false);
  });
});

describe("streaming gaps — G61 HLOD real", () => {
  it("funde malhas estáticas do setor, troca proxy/originais pela distância e reporta estatística real", () => {
    const { service } = createService();
    const render = createRender();
    service.bindDependencies({ render: render.api });
    service.setStreamingRadius(80, 10);
    service.registerSector(sector(0, 0));
    const material = new THREE.MeshLambertMaterial();
    const other = new THREE.MeshLambertMaterial();
    const keys: string[] = [];

    for (let i = 0; i < 5; i += 1) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), i < 4 ? material : other);
      mesh.position.set(i * 3, 0, 0);
      render.api.addMeshToScene(`house_${i}`, mesh);
      keys.push(`house_${i}`);
    }

    service.updateStreamingCenter({ x: 0, y: 0, z: 0 });
    const result = service.buildHLOD({ x: 0, y: 0, z: 0 }, keys);
    expect(result).toMatchObject({ sceneKey: "hlod_0:0:0", sourceMeshCount: 5, mergedDrawCalls: 2 });
    const proxy = render.scene.get("hlod_0:0:0")!;
    expect(proxy.children).toHaveLength(2);
    // Vértices em espaço de mundo.
    const geometry = (proxy.children[0] as THREE.Mesh).geometry;
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.max.x).toBeCloseTo(9.5, 5);
    expect(service.getHLODStats()).toEqual({ totalClusters: 1, drawCallsSaved: 3, mergedMeshCount: 5 });

    // Perto: proxy oculto. Longe: proxy visível, originais ocultos.
    expect(proxy.visible).toBe(false);
    service.update({ x: 500, y: 0, z: 0 }, 0.016);
    expect(service.isHLODActive({ x: 0, y: 0, z: 0 })).toBe(true);
    expect(proxy.visible).toBe(true);
    expect(render.scene.get("house_0")!.visible).toBe(false);
    service.update({ x: 0, y: 0, z: 0 }, 0.016);
    expect(proxy.visible).toBe(false);
    expect(render.scene.get("house_0")!.visible).toBe(true);

    expect(service.removeHLOD({ x: 0, y: 0, z: 0 })).toBe(true);
    expect(render.scene.has("hlod_0:0:0")).toBe(false);
    expect(service.getHLODStats().totalClusters).toBe(0);
  });

  it("buildHLODFromCluster carrega staticMeshUrls via assets, funde e libera", async () => {
    const { service } = createService();
    const render = createRender();
    const material = new THREE.MeshBasicMaterial();
    const refs = new Map<string, number>();
    const assets = {
      async loadGLTF(url: string) {
        refs.set(url, (refs.get(url) ?? 0) + 1);
        const scene = new THREE.Group();
        scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material));
        return { scene };
      },
      releaseAsset(url: string) {
        refs.set(url, (refs.get(url) ?? 1) - 1);
      },
    } as unknown as AssetsApi;
    service.bindDependencies({ render: render.api, assets });
    service.registerSector(sector(0, 0, [], {
      hlodCluster: {
        clusterId: "village",
        sectorCoord: { x: 0, y: 0, z: 0 },
        staticMeshUrls: ["a.glb", "b.glb", "c.glb"],
        combinedMeshUrl: "",
        boundingCenter: { x: 0, y: 0, z: 0 },
        boundingRadius: 25,
      },
    }));
    const result = await service.buildHLODFromCluster({ x: 0, y: 0, z: 0 });
    expect(result).toMatchObject({ sourceMeshCount: 3, mergedDrawCalls: 1 });
    expect([...refs.values()].every((count) => count === 0)).toBe(true);
  });
});

describe("streaming gaps — G62 clear/unregister", () => {
  it("clear emite sector-unloaded, preserva câmera/raio e é reutilizável; unregisterSector", async () => {
    const { service, emitted } = createService();
    const camera = { getCurrentCameraSnapshot: () => ({ position: { x: 0, y: 0, z: 0 } }) } as unknown as CameraApi;
    service.bindDependencies({ camera });
    service.setStreamingRadius(30, 5);
    service.registerSector(sector(0, 0));
    service.registerSector(sector(1, 0)); // centro em x=50: fora do raio 30
    service.updateFromBoundCamera(0.2);
    expect(service.getActiveSectors()).toHaveLength(1);
    service.clear();
    expect(emitted.filter((e) => e.type === "game.streaming.sector-unloaded")).toHaveLength(1);

    // Câmera e raio preservados.
    service.registerSector(sector(0, 0));
    service.registerSector(sector(1, 0));
    service.updateFromBoundCamera(0.2);
    expect(service.getActiveSectors()).toHaveLength(1);

    expect(service.unregisterSector({ x: 0, y: 0, z: 0 })).toBe(true);
    expect(emitted.filter((e) => e.type === "game.streaming.sector-unloaded")).toHaveLength(2);
    expect(service.getStats().registeredSectors).toBe(1);
    expect(service.unregisterSector({ x: 0, y: 0, z: 0 })).toBe(false);
  });
});

describe("streaming gaps — G63 LOD", () => {
  it("níveis fora de ordem, nível inicial imediato, entidade móvel e histerese configurável", () => {
    const { service, emitted } = createService();
    service.updateStreamingCenter({ x: 0, y: 0, z: 0 });
    service.registerLODEntity({
      entityId: "rock",
      worldPosition: { x: 60, y: 0, z: 0 },
      currentLevel: 0,
      lodLevels: [
        { level: 2, distanceThreshold: 50, meshUrl: "" },
        { level: 0, distanceThreshold: 0, meshUrl: "" },
        { level: 1, distanceThreshold: 20, meshUrl: "" },
      ],
    });
    // Imediato, sem esperar tick.
    expect(service.getEntityLODLevel("rock")).toBe(2);
    expect(emitted.filter((e) => e.type === "game.streaming.lod-changed")).toHaveLength(1);

    expect(service.updateLODEntityPosition("rock", { x: 25, y: 0, z: 0 })).toBe(true);
    service.update({ x: 0, y: 0, z: 0 }, 0.016);
    expect(service.getEntityLODLevel("rock")).toBe(1);

    // Histerese configurável: com 10, 32 de distância não sobe para 2 nem desce para 0 em 15.
    service.setLODHysteresis(10);
    service.updateLODEntityPosition("rock", { x: 55, y: 0, z: 0 });
    service.update({ x: 0, y: 0, z: 0 }, 0.016);
    expect(service.getEntityLODLevel("rock")).toBe(1);
    service.updateLODEntityPosition("rock", { x: 61, y: 0, z: 0 });
    service.update({ x: 0, y: 0, z: 0 }, 0.016);
    expect(service.getEntityLODLevel("rock")).toBe(2);
    service.updateLODEntityPosition("rock", { x: 15, y: 0, z: 0 });
    service.update({ x: 0, y: 0, z: 0 }, 0.016);
    expect(service.getEntityLODLevel("rock")).toBe(1);

    // Histerese por entidade.
    service.registerLODEntity({
      entityId: "bush",
      worldPosition: { x: 21, y: 0, z: 0 },
      currentLevel: 0,
      hysteresis: 0,
      lodLevels: [
        { level: 0, distanceThreshold: 0, meshUrl: "" },
        { level: 1, distanceThreshold: 20, meshUrl: "" },
      ],
    });
    expect(service.getEntityLODLevel("bush")).toBe(1);
  });
});

describe("streaming gaps — plugin", () => {
  it("camera/render/assets são consumidores opcionais declarados", () => {
    const manifest = createStreamingPlugin().manifest;
    const consumes = manifest.capabilities?.consumes ?? [];

    for (const token of [CameraToken, RenderToken, AssetsToken]) {
      expect(consumes.find((c) => c.id === token.id)?.optional).toBe(true);
      expect(manifest.permissions?.capabilities).toContain(token.id);
    }
  });
});
