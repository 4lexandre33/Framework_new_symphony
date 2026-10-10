// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { PluginContext } from "@core";

import type { SceneDescriptor } from "../src/contracts/world/types";
import { OctreeManager } from "../src/engine/world/internal/OctreeManager";
import { SpatialGrid } from "../src/engine/world/internal/SpatialGrid";
import { WorldService } from "../src/engine/world/internal/WorldService";

interface Emitted {
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

interface FakeAssets {
  readonly loaded: string[];
  readonly released: string[];
  loadGLTF(url: string): Promise<unknown>;
  loadTexture(url: string): Promise<unknown>;
  loadAudio(url: string): Promise<unknown>;
  releaseAsset(url: string): void;
  getAsset(): null;
  clearCache(): void;
}

function createFakeAssets(failing: ReadonlySet<string> = new Set()): FakeAssets {
  const loaded: string[] = [];
  const released: string[] = [];
  const load = async (url: string): Promise<unknown> => {
    if (failing.has(url)) {
      throw new Error(`404 ${url}`);
    }
    loaded.push(url);
    return {};
  };
  return {
    loaded,
    released,
    loadGLTF: load,
    loadTexture: load,
    loadAudio: load,
    releaseAsset(url: string): void {
      released.push(url);
    },
    getAsset: () => null,
    clearCache(): void {},
  };
}

function createWorld(capabilities: Record<string, unknown> = {}): { world: WorldService; emitted: Emitted[] } {
  const emitted: Emitted[] = [];
  const ctx = {
    events: {
      emit(type: string, payload: Record<string, unknown>): void {
        emitted.push({ type, payload });
      },
    },
    caps: {
      get(token: { id: string }): unknown {
        return capabilities[token.id];
      },
    },
  } as unknown as PluginContext;
  return { world: new WorldService(ctx), emitted };
}

const scene = (sceneId: string, extra: Partial<SceneDescriptor> = {}): SceneDescriptor => ({
  sceneId,
  sceneName: sceneId,
  assetsToPreload: [],
  ...extra,
});

describe("world gaps (G6, G31, G64–G68)", () => {
  it("G6: updateEntityTransform/patchEntity movem a entidade e atualizam os índices na hora", () => {
    const { world, emitted } = createWorld();
    expect(world.spawnEntity({ entityId: "npc", position: { x: 0, y: 0, z: 0 }, tags: ["a"] })).toBe(true);
    emitted.length = 0;

    expect(world.updateEntityTransform("npc", { position: { x: 100, y: 5, z: 100 } })).toBe(true);
    expect(world.getEntityState("npc")?.position).toEqual({ x: 100, y: 5, z: 100 });
    expect(world.getEntityState("npc")?.tags).toEqual(["a"]);
    expect(world.querySpatialGrid({ x: 100, z: 100 }, 1)[0]?.entityId).toBe("npc");
    expect(world.querySpatialGrid({ x: 0, z: 0 }, 1)).toHaveLength(0);
    expect(world.querySphere({ x: 100, y: 5, z: 100 }, 0.5)[0]?.entityId).toBe("npc");
    // Sem eventos de spawn/despawn ao mover.
    expect(emitted).toHaveLength(0);

    expect(world.patchEntity("npc", { tags: ["b"], customData: { hp: 3 } })).toBe(true);
    expect(world.getEntityState("npc")?.tags).toEqual(["b"]);
    expect(world.getEntityState("npc")?.customData).toEqual({ hp: 3 });
    expect(world.getEntityState("npc")?.position.x).toBe(100);

    expect(world.updateEntityTransform("missing", { position: { x: 1, y: 1, z: 1 } })).toBe(false);
    expect(world.updateEntityTransform("npc", { position: { x: Number.NaN, y: 0, z: 0 } })).toBe(false);
    expect(world.updateEntityTransform("npc", { rotation: { x: 0, y: 0, z: 0, w: 0 } })).toBe(false);
    expect(world.getEntityState("npc")?.position.x).toBe(100);
    expect(world.hasEntity("npc")).toBe(true);
  });

  it("G31: getEntityState devolve snapshot imutável que nunca muda depois de entregue", () => {
    const { world } = createWorld();
    world.spawnEntity({ entityId: "e", position: { x: 1, y: 2, z: 3 } });
    const before = world.getEntityState("e");
    expect(Object.isFrozen(before)).toBe(true);
    expect(Object.isFrozen(before?.position)).toBe(true);
    expect(Object.isFrozen(before?.tags)).toBe(true);

    world.updateEntityTransform("e", { position: { x: 9, y: 9, z: 9 } });
    expect(before?.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(world.getEntityState("e")).not.toBe(before);

    const results = world.querySpatialGrid({ x: 9, z: 9 }, 1);
    const all = world.getAllEntities();
    expect(all).toHaveLength(1);
    expect(results[0]?.position).not.toBe(world.querySpatialGrid({ x: 9, z: 9 }, 1)[0]?.position);
  });

  it("G64: octree cobre entidades fora de worldBounds (auto-expansão)", async () => {
    const { world } = createWorld();
    await world.loadScene(scene("small", {
      worldBounds: { min: { x: -10, y: -10, z: -10 }, max: { x: 10, y: 10, z: 10 } },
    }));
    world.spawnEntity({ entityId: "far", position: { x: 5000, y: -300, z: -7000 } });
    world.spawnEntity({ entityId: "near", position: { x: 1, y: 1, z: 1 } });

    const far = world.queryOctree({ min: { x: 4990, y: -310, z: -7010 }, max: { x: 5010, y: -290, z: -6990 } });
    expect(far.map((result) => result.entityId)).toEqual(["far"]);
    expect(world.querySphere({ x: 5000, y: -300, z: -7000 }, 1)).toHaveLength(1);

    const octree = new OctreeManager({ min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } });
    octree.insert("outside", { x: -50, y: 50, z: 50 });
    expect(octree.queryBounds({ min: { x: -60, y: 40, z: 40 }, max: { x: -40, y: 60, z: 60 } })).toHaveLength(1);
    expect(octree.getEffectiveBounds().min.x).toBeLessThanOrEqual(-50);
    expect(octree.configuredWorldBounds.min.x).toBe(0);
  });

  it("G65: deserialize valida antes, preserva o estado em erro, restaura sceneId e emite eventos", async () => {
    const { world, emitted } = createWorld();
    await world.loadScene(scene("level-1"));
    world.spawnEntity({ entityId: "a", position: { x: 1, y: 0, z: 0 } });
    world.spawnEntity({ entityId: "b", position: { x: 2, y: 0, z: 0 } });
    const saved = world.serializeWorldState();

    await world.loadScene(scene("level-2"));
    world.spawnEntity({ entityId: "c" });
    emitted.length = 0;

    // JSON inválido, entidade inválida e id duplicado: nada muda.
    expect(world.deserializeWorldState("{not json")).toBe(false);
    const broken = JSON.parse(saved) as { entities: Array<Record<string, unknown>> };
    broken.entities.push({ entityId: "bad", position: { x: "oops" } });
    expect(world.deserializeWorldState(JSON.stringify(broken))).toBe(false);
    const duplicated = JSON.parse(saved) as { entities: Array<Record<string, unknown>> };
    duplicated.entities.push(duplicated.entities[0] as Record<string, unknown>);
    expect(world.deserializeWorldState(JSON.stringify(duplicated))).toBe(false);
    expect(world.currentSceneId).toBe("level-2");
    expect(world.hasEntity("c")).toBe(true);
    expect(emitted).toHaveLength(0);

    expect(world.deserializeWorldState(saved)).toBe(true);
    expect(world.currentSceneId).toBe("level-1");
    expect(world.hasEntity("c")).toBe(false);
    expect(world.activeEntityCount).toBe(2);
    expect(world.querySpatialGrid({ x: 1, z: 0 }, 0.5)[0]?.entityId).toBe("a");

    const types = emitted.map((event) => event.type);
    expect(types).toContain("game.world.entity-despawned");
    expect(emitted.filter((event) => event.type === "game.world.entity-spawned")).toHaveLength(2);
    expect(emitted.at(-1)).toEqual({
      type: "game.world.state-restored",
      payload: { sceneId: "level-1", totalEntities: 2 },
    });
  });

  it("G66: loadScene pré-carrega assets via game.assets com progresso real e libera no unload", async () => {
    const assets = createFakeAssets(new Set(["missing.png"]));
    const { world, emitted } = createWorld({ "game.assets": assets });

    const loaded = await world.loadScene(
      scene("forest", {
        assetsToPreload: [
          { id: "tree", url: "tree.glb", type: "gltf" },
          { id: "grass", url: "grass.png", type: "texture" },
          { id: "missing", url: "missing.png", type: "texture" },
        ],
      }),
      { showLoadingScreen: true },
    );
    expect(loaded).toBe(true);
    expect(assets.loaded.sort()).toEqual(["grass.png", "tree.glb"]);

    const progress = emitted.filter((event) => event.type === "game.world.scene-loading");
    expect(progress.every((event) => event.payload.showLoadingScreen === true)).toBe(true);
    expect(progress.map((event) => event.payload.progressPercentage)).toEqual([0, 30, 60, 90, 100]);

    const loadedEvent = emitted.find((event) => event.type === "game.world.scene-loaded");
    expect(loadedEvent?.payload.loadedAssets).toBe(2);
    expect(loadedEvent?.payload.failedAssets).toEqual(["missing.png"]);

    world.spawnEntity({ entityId: "tree-1" });
    emitted.length = 0;
    expect(await world.unloadScene("forest")).toBe(true);
    expect(assets.released.sort()).toEqual(["grass.png", "tree.glb"]);
    expect(emitted.map((event) => event.type)).toEqual([
      "game.world.entity-despawned",
      "game.world.scene-unloaded",
    ]);
    expect(emitted[0]?.payload).toEqual({ entityId: "tree-1" });
  });

  it("G66: failOnAssetError aborta a cena e libera o que carregou; autoStartLoop inicia o loop", async () => {
    const assets = createFakeAssets(new Set(["broken.ogg"]));
    const loopCalls: string[] = [];
    const loop = {
      start(): void {
        loopCalls.push("start");
      },
      resume(): void {
        loopCalls.push("resume");
      },
    };
    const { world } = createWorld({ "game.assets": assets, "game.loop": loop });

    const ok = await world.loadScene(
      scene("bad", {
        assetsToPreload: [
          { id: "music", url: "broken.ogg", type: "audio" },
          { id: "tex", url: "tex.png", type: "texture" },
        ],
      }),
      { failOnAssetError: true },
    );
    expect(ok).toBe(false);
    expect(world.currentSceneId).toBeNull();
    expect(assets.released).toEqual(["tex.png"]);

    expect(await world.loadScene(scene("good"), { autoStartLoop: true })).toBe(true);
    expect(loopCalls).toEqual(["start", "resume"]);
  });

  it("G66: sem game.assets a cena carrega e informa os assets não carregados", async () => {
    const { world, emitted } = createWorld();
    expect(
      await world.loadScene(scene("plain", { assetsToPreload: [{ id: "x", url: "x.glb", type: "gltf" }] })),
    ).toBe(true);
    const loadedEvent = emitted.find((event) => event.type === "game.world.scene-loaded");
    expect(loadedEvent?.payload.failedAssets).toEqual(["x.glb"]);
  });

  it("G66: trocar de cena (clearPreviousScene) emite entity-despawned", async () => {
    const { world, emitted } = createWorld();
    await world.loadScene(scene("one"));
    world.spawnEntity({ entityId: "p" });
    emitted.length = 0;
    await world.loadScene(scene("two"));
    expect(emitted.some((event) => event.type === "game.world.entity-despawned" && event.payload.entityId === "p")).toBe(true);
  });

  it("G67: spawnEntity aceita campos opcionais com padrões e rejeita valores inválidos sem lançar", () => {
    const { world } = createWorld();
    expect(world.spawnEntity({ entityId: "minimal" })).toBe(true);
    expect(world.getEntityState("minimal")).toEqual({
      entityId: "minimal",
      type: "entity",
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
      tags: [],
      customData: {},
    });
    expect(world.spawnEntity({ entityId: "partial", position: { x: 5 } })).toBe(true);
    expect(world.getEntityState("partial")?.position).toEqual({ x: 5, y: 0, z: 0 });

    expect(world.spawnEntity({ entityId: "" })).toBe(false);
    expect(world.spawnEntity({ entityId: "nan", position: { x: Number.NaN, y: 0, z: 0 } })).toBe(false);
    expect(world.spawnEntity({ entityId: "tags", tags: [1 as unknown as string] })).toBe(false);
    expect(world.spawnEntity(null as unknown as { entityId: string })).toBe(false);
    expect(world.activeEntityCount).toBe(2);
  });

  it("G67/G68: querySpatialGrid com raio enorme é ordenado e não varre células vazias", () => {
    const grid = new SpatialGrid(16);
    grid.insert("far", { x: 300, y: 0, z: 0 });
    grid.insert("mid", { x: 0, y: 0, z: 100 });
    grid.insert("near", { x: 3, y: 50, z: 4 });

    const started = performance.now();
    const results = grid.queryRadius({ x: 0, z: 0 }, 1e9);
    expect(performance.now() - started).toBeLessThan(50);
    expect(results.map((result) => result.entityId)).toEqual(["near", "mid", "far"]);
    expect(results[0]?.distance).toBeCloseTo(5, 6);
  });

  it("G68: queryOctree devolve distância real ao centro do AABB, ordenado", () => {
    const { world } = createWorld();
    world.spawnEntity({ entityId: "corner", position: { x: 3, y: 4, z: 0 } });
    world.spawnEntity({ entityId: "center", position: { x: 0, y: 0, z: 0 } });
    const results = world.queryOctree({ min: { x: -5, y: -5, z: -5 }, max: { x: 5, y: 5, z: 5 } });
    expect(results.map((result) => result.entityId)).toEqual(["center", "corner"]);
    expect(results[1]?.distance).toBeCloseTo(5, 6);
    const sphere = world.querySphere({ x: 0, y: 0, z: 0 }, 4.9);
    expect(sphere.map((result) => result.entityId)).toEqual(["center"]);
  });
});
