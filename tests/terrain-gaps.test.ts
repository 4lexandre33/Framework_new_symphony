// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";

import type { PluginContext } from "@core";

import type { ChunkDataMatrix, TerrainEditsSnapshot, Vector3Chunk } from "../src/contracts/terrain/types";
import { TERRAIN_CHUNK_SIZE_Y } from "../src/contracts/terrain/types";
import { BlockPalette } from "../src/engine/terrain/internal/BlockPalette";
import { GreedyMesher } from "../src/engine/terrain/internal/GreedyMesher";
import { ProceduralWorkerPool, type TerrainChunkWorkerPool } from "../src/engine/terrain/internal/ProceduralWorkerPool";
import { TerrainGenerator, createColumnSample } from "../src/engine/terrain/internal/TerrainGenerator";
import { TerrainService } from "../src/engine/terrain/internal/TerrainService";
import { VoxelChunkManager } from "../src/engine/terrain/internal/VoxelChunkManager";
import { PhysicsService } from "../src/engine/physics/internal/PhysicsService";
import { PhysicsWorld } from "../src/engine/physics/internal/PhysicsWorld";
import { createTerrainPlugin } from "../src/plugins/terrain/plugin";
import type { Render3DApi } from "../src/tokens/render";
import type { CameraApi } from "../src/tokens/camera";
import { PhysicsToken } from "../src/tokens/physics";
import { CameraToken } from "../src/tokens/camera";

interface Emitted {
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

function createCtx(emitted: Emitted[]): PluginContext {
  return {
    events: {
      emit(type: string, payload: Record<string, unknown>): void {
        emitted.push({ type, payload });
      },
      async emitAsync(type: string, payload: Record<string, unknown>): Promise<void> {
        emitted.push({ type, payload });
      },
    },
    log: { debug(): void {}, info(): void {}, warn(): void {}, error(): void {} },
  } as unknown as PluginContext;
}

interface FakeRender {
  readonly api: Render3DApi;
  readonly scene: Map<string, THREE.Object3D>;
  readonly adds: string[];
  readonly removes: string[];
}

function createRender(): FakeRender {
  const scene = new Map<string, THREE.Object3D>();
  const adds: string[] = [];
  const removes: string[] = [];
  const api = {
    addMeshToScene(key: string, object: THREE.Object3D): void {
      scene.set(key, object);
      adds.push(key);
    },
    removeMeshFromScene(key: string): void {
      scene.delete(key);
      removes.push(key);
    },
    getMeshFromScene(key: string): THREE.Object3D | null {
      return scene.get(key) ?? null;
    },
  } as unknown as Render3DApi;
  return { api, scene, adds, removes };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const services: TerrainService[] = [];

function createTerrain(options: { physics?: PhysicsService; pool?: TerrainChunkWorkerPool; render?: boolean } = {}) {
  const emitted: Emitted[] = [];
  const render = createRender();
  const service = new TerrainService(createCtx(emitted), new VoxelChunkManager(), options.pool ?? new ProceduralWorkerPool(0));
  service.bindDependencies(options.render === false ? null : render.api, options.physics ?? null, null);
  services.push(service);
  return { service, render, emitted };
}

async function loadChunks(service: TerrainService, coords: ReadonlyArray<Vector3Chunk>): Promise<void> {
  service.configure({ meshing: { maxMeshesPerUpdate: 64, budgetMs: 1000 } });

  for (const coord of coords) {
    service.requestChunk(coord);
  }

  await flush();
  service.update(1 / 60);
}

function opaqueGeometry(render: FakeRender, key: string): THREE.BufferGeometry {
  const object = render.scene.get(key);
  expect(object).toBeDefined();
  const mesh = object!.children.find((child) => child.name.endsWith("_opaque")) as THREE.Mesh;
  expect(mesh).toBeDefined();
  return mesh.geometry;
}

function findColumn(generator: TerrainGenerator, predicate: (height: number, biome: string) => boolean): { x: number; z: number } {
  const sample = createColumnSample();

  for (let z = -2000; z < 2000; z += 16) {
    for (let x = -2000; x < 2000; x += 16) {
      generator.sampleColumn(x, z, sample);

      if (predicate(sample.height, sample.biome.biomeId)) {
        return { x, z };
      }
    }
  }

  throw new Error("coluna não encontrada");
}

afterEach(() => {
  while (services.length > 0) {
    services.pop()!.dispose();
  }
});

describe("terrain gaps — G3 colliders, paleta e streaming", () => {
  it("G3: cria collider trimesh por chunk via PhysicsApi e remove no unload", async () => {
    const physics = new PhysicsService(createCtx([]), new PhysicsWorld());
    expect(await physics.initialize()).toBe(true);

    try {
      const { service } = createTerrain({ physics });
      await loadChunks(service, [{ x: 0, y: 0, z: 0 }]);
      expect(physics.hasBody("terrain_chunk_0:0:0")).toBe(true);
      expect(service.getStats().colliders).toBe(1);

      const surface = service.getSurfaceHeight(8, 8);
      expect(surface).toBeGreaterThan(0);
      physics.step(1 / 60);
      const hit = physics.castRay({
        origin: { x: 8.5, y: 255, z: 8.5 },
        direction: { x: 0, y: -1, z: 0 },
        maxDistance: 300,
      });
      expect(hit.hit).toBe(true);
      expect(hit.entityId).toBe("terrain_chunk_0:0:0");
      expect(hit.point.y).toBeCloseTo(surface + 1, 3);

      // Cavar o bloco do topo atualiza o collider na hora.
      expect(service.modifyVoxelBlock({ worldPosition: { x: 8, y: surface, z: 8 }, newBlockId: 0 })).toBe(true);
      physics.step(1 / 60);
      const after = physics.castRay({ origin: { x: 8.5, y: 255, z: 8.5 }, direction: { x: 0, y: -1, z: 0 }, maxDistance: 300 });
      expect(after.point.y).toBeCloseTo(surface, 3);

      expect(service.unloadChunk({ x: 0, y: 0, z: 0 })).toBe(true);
      expect(physics.hasBody("terrain_chunk_0:0:0")).toBe(false);
    } finally {
      physics.dispose();
    }
  });

  it("G3: paleta por id (cores por vértice), materiais compartilhados retidos e tom de bioma", async () => {
    const palette = new BlockPalette();
    const chunk: ChunkDataMatrix = {
      coord: { x: 0, y: 0, z: 0 },
      sizeX: 2,
      sizeY: 1,
      sizeZ: 1,
      blocks: new Uint8Array([2, 4]),
    };
    const compiled = GreedyMesher.compileChunkMesh(chunk, { palette });
    expect(compiled.colors).toBeDefined();
    const distinct = new Set<string>();

    for (let i = 0; i < compiled.colors!.length; i += 3) {
      distinct.add(`${compiled.colors![i]!.toFixed(3)},${compiled.colors![i + 1]!.toFixed(3)},${compiled.colors![i + 2]!.toFixed(3)}`);
    }

    expect(distinct.size).toBe(2); // pedra e areia

    const { service, render } = createTerrain();
    await loadChunks(service, [{ x: 0, y: 0, z: 0 }]);
    const geometry = opaqueGeometry(render, "chunk_0:0:0");
    expect(geometry.getAttribute("color")).toBeDefined();
    const mesh = render.scene.get("chunk_0:0:0")!.children[0] as THREE.Mesh;
    expect((mesh.material as THREE.Material).userData.renderRetain).toBe(true);
    expect((mesh.material as THREE.MeshLambertMaterial).vertexColors).toBe(true);

    // Redefinir a cor do bloco da superfície remonta e muda as cores.
    const surfaceId = service.getVoxelBlock({ x: 8, y: service.getSurfaceHeight(8, 8), z: 8 }).id;
    const before = Array.from((geometry.getAttribute("color") as THREE.BufferAttribute).array);
    expect(service.setBlockDefinition(surfaceId, { color: 0xff0000 })).toBe(true);
    service.update(1 / 60);
    const geometryAfter = opaqueGeometry(render, "chunk_0:0:0");
    const afterColors = Array.from((geometryAfter.getAttribute("color") as THREE.BufferAttribute).array);
    expect(afterColors).not.toEqual(before);
    expect(service.getBlockDefinition(surfaceId)?.color).toBe(0xff0000);

    // Tom de bioma: grama de biomas diferentes tem cores diferentes.
    const generator = new TerrainGenerator(1337);
    const sample = createColumnSample();
    const forest = findColumn(generator, (_h, biome) => biome === "forest");
    const tundra = findColumn(generator, (_h, biome) => biome === "tundra");
    generator.sampleColumn(forest.x, forest.z, sample);
    const forestTint = [sample.tintR, sample.tintG, sample.tintB];
    generator.sampleColumn(tundra.x, tundra.z, sample);
    expect([sample.tintR, sample.tintG, sample.tintB]).not.toEqual(forestTint);
  });

  it("G3: streaming automático carrega/descarrega em volta do centro; chunks manuais ficam fixos", async () => {
    const { service, emitted } = createTerrain();
    service.configure({
      streaming: { enabled: true, radiusChunks: 2, unloadMarginChunks: 0, maxRequestsPerUpdate: 100 },
      meshing: { maxMeshesPerUpdate: 100, budgetMs: 1000 },
    });
    service.requestChunk({ x: 0, y: 0, z: 0 }); // manual (fixo)
    service.update(1 / 60, { x: 8, y: 0, z: 8 });
    await flush();
    service.update(1 / 60);
    // Raio 2 em chunks: 13 colunas (disco discreto).
    expect(service.getActiveChunkCount()).toBe(13);
    expect(emitted.filter((e) => e.type === "game.terrain.chunk-generated")).toHaveLength(13);

    // Descarga manual dentro do raio é respeitada.
    expect(service.unloadChunk({ x: 1, y: 0, z: 0 })).toBe(true);
    service.update(1 / 60);
    await flush();
    service.update(1 / 60);
    expect(service.getActiveChunkCount()).toBe(12);

    // Longe: os do streaming saem, o manual (0,0,0) fica.
    service.update(1 / 60, { x: 16 * 40, y: 0, z: 0 });
    await flush();
    service.update(1 / 60);
    expect(service.getVoxelBlock({ x: 0, y: 1, z: 0 }).id).not.toBe(0);
    expect(service.getActiveChunkCount()).toBe(13 + 1);
    expect(emitted.some((e) => e.type === "game.terrain.chunk-unloaded")).toBe(true);
  });

  it("G3: streaming limita pedidos por update e pode seguir a câmera", async () => {
    const emitted: Emitted[] = [];
    const service = new TerrainService(createCtx(emitted), new VoxelChunkManager(), new ProceduralWorkerPool(0));
    services.push(service);
    const camera = {
      getCurrentCameraSnapshot: () => ({ position: { x: 1000, y: 50, z: 1000 } }),
    } as unknown as CameraApi;
    service.bindDependencies(createRender().api, null, camera);
    service.configure({ streaming: { enabled: true, radiusChunks: 1, maxRequestsPerUpdate: 2, centerSource: "camera" } });
    service.update(1 / 60);
    expect(service.getStats().pendingGenerations).toBe(2);
    await flush();
    service.update(1 / 60);
    service.update(1 / 60);
    await flush();
    service.update(1 / 60);
    await flush();
    expect(service.getActiveChunkCount()).toBe(5);
    expect(service.getVoxelBlock({ x: 1000, y: 1, z: 1000 }).id).not.toBe(0);
  });
});

describe("terrain gaps — G18 lote", () => {
  it("modifyVoxelBlocks remonta cada chunk uma vez e emite um evento por voxel", async () => {
    const { service, render, emitted } = createTerrain();
    await loadChunks(service, [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }]);
    render.adds.length = 0;
    emitted.length = 0;
    const requests = [];

    for (let x = 1; x < 15; x += 1) {
      for (let z = 1; z < 5; z += 1) {
        requests.push({ worldPosition: { x, y: 2, z }, newBlockId: 6 });
      }
    }

    expect(service.modifyVoxelBlocks(requests)).toBe(requests.length);
    expect(render.adds.filter((k) => k === "chunk_0:0:0")).toHaveLength(1);
    expect(render.adds.filter((k) => k === "chunk_1:0:0")).toHaveLength(0);
    expect(emitted.filter((e) => e.type === "game.terrain.block-modified")).toHaveLength(requests.length);

    // Edição na borda remonta também o vizinho (a face entre eles muda).
    render.adds.length = 0;
    service.modifyVoxelBlocks([{ worldPosition: { x: 15, y: 3, z: 3 }, newBlockId: 0 }]);
    expect(new Set(render.adds)).toEqual(new Set(["chunk_0:0:0", "chunk_1:0:0"]));
  });
});

describe("terrain gaps — G54/G57 altura e biomas", () => {
  it("G54: montanhas acima de 128 ficam dentro do chunk y=0 (256 de altura), sem platô", async () => {
    const generator = new TerrainGenerator(1337);
    const column = findColumn(generator, (height) => height > 150);
    const { service } = createTerrain();
    const coord = { x: Math.floor(column.x / 16), y: 0, z: Math.floor(column.z / 16) };
    await loadChunks(service, [coord]);
    const expected = generator.sampleColumn(column.x, column.z, createColumnSample()).height;
    expect(TERRAIN_CHUNK_SIZE_Y).toBe(256);
    expect(service.getVoxelBlock({ x: column.x, y: expected, z: column.z }).id).not.toBe(0);
    expect(service.getVoxelBlock({ x: column.x, y: expected + 1, z: column.z }).id).toBe(0);
    expect(service.getSurfaceHeight(column.x, column.z)).toBe(expected);
  });

  it("G57: fronteiras misturadas (sem paredes) e floresta não domina o mundo", () => {
    const generator = new TerrainGenerator(1337);
    const sample = createColumnSample();
    let maxStep = 0;

    for (let z = -1500; z < 1500; z += 50) {
      let previous = Number.NaN;

      for (let x = -1500; x < 1500; x += 1) {
        const height = generator.sampleColumn(x, z, sample).height;

        if (!Number.isNaN(previous)) {
          maxStep = Math.max(maxStep, Math.abs(height - previous));
        }

        previous = height;
      }
    }

    expect(maxStep).toBeLessThanOrEqual(16);
    const counts = new Map<string, number>();
    let total = 0;

    for (let z = -1600; z < 1600; z += 8) {
      for (let x = -1600; x < 1600; x += 8) {
        const biome = generator.sampleColumn(x, z, sample).biome.biomeId;
        counts.set(biome, (counts.get(biome) ?? 0) + 1);
        total += 1;
      }
    }

    expect(counts.size).toBe(4);

    for (const count of counts.values()) {
      expect(count / total).toBeLessThan(0.5);
      expect(count / total).toBeGreaterThan(0.1);
    }
  });
});

describe("terrain gaps — G55/G56 seed e edições persistentes", () => {
  it("G55: setSeed com mundo carregado emite reset; comando com seed divergente é recusado sem apagar", async () => {
    const { service, emitted } = createTerrain();
    await loadChunks(service, [{ x: 0, y: 0, z: 0 }]);
    service.setSeed(4242);
    const reset = emitted.find((e) => e.type === "game.terrain.reset");
    expect(reset?.payload).toMatchObject({ reason: "seed-changed", previousSeed: 1337, seed: 4242, unloadedChunks: 1 });

    // Plugin: request-chunk com seed diferente.
    const handlers = new Map<string, (env: { payload: unknown }) => unknown>();
    const warnings: string[] = [];
    let provided: TerrainService | null = null;
    const pluginCtx = {
      caps: {
        provide(_token: unknown, value: TerrainService): void {
          provided = value;
        },
      },
      events: { define(): void {}, on: () => () => {}, emit(): void {} },
      commands: {
        define(): void {},
        handle(type: string, fn: (env: { payload: unknown }) => unknown) {
          handlers.set(type, fn);
          return () => {};
        },
      },
      lifecycle: { onDispose(): void {}, ready(): void {} },
      log: { warn: (msg: string) => warnings.push(msg), error(): void {}, info(): void {}, debug(): void {} },
    } as unknown as PluginContext;
    const plugin = createTerrainPlugin();
    plugin.setup(pluginCtx);
    const pluginService = provided as unknown as TerrainService;
    services.push(pluginService);
    const request = handlers.get("game.terrain.request-chunk")!;
    // Mundo vazio: seed do comando é adotada.
    expect(request({ payload: { chunkCoord: { x: 0, y: 0, z: 0 }, seed: 77 } })).toBe(true);
    expect(pluginService.getSeed()).toBe(77);
    // Mundo com conteúdo: seed divergente é recusada e nada é apagado.
    expect(request({ payload: { chunkCoord: { x: 1, y: 0, z: 0 }, seed: 99 } })).toBe(false);
    expect(pluginService.getSeed()).toBe(77);
    expect(pluginService.hasWorldContent()).toBe(true);
    expect(warnings).toHaveLength(1);
    // Sem seed: usa a atual.
    expect(request({ payload: { chunkCoord: { x: 1, y: 0, z: 0 } } })).toBe(true);
  });

  it("G56: edições sobrevivem a unload/reload, exportam/importam; requestChunk repetido é idempotente", async () => {
    const { service, render, emitted } = createTerrain();
    await loadChunks(service, [{ x: 0, y: 0, z: 0 }]);
    const surface = service.getSurfaceHeight(4, 4);
    service.modifyVoxelBlocks([
      { worldPosition: { x: 4, y: surface + 1, z: 4 }, newBlockId: 6, newMetadata: 9 },
      { worldPosition: { x: 5, y: surface, z: 5 }, newBlockId: 0 },
    ]);

    // Idempotente: sem nova malha nem novo chunk-generated.
    render.adds.length = 0;
    emitted.length = 0;
    service.requestChunk({ x: 0, y: 0, z: 0 });
    await flush();
    service.update(1 / 60);
    expect(render.adds).toHaveLength(0);
    expect(emitted).toHaveLength(0);

    service.unloadChunk({ x: 0, y: 0, z: 0 });
    expect(service.getVoxelBlock({ x: 4, y: surface + 1, z: 4 }).id).toBe(0);
    await loadChunks(service, [{ x: 0, y: 0, z: 0 }]);
    expect(service.getVoxelBlock({ x: 4, y: surface + 1, z: 4 })).toEqual({ id: 6, metadata: 9 });
    expect(service.getVoxelBlock({ x: 5, y: service.getSurfaceHeight(5, 5) + 1, z: 5 }).id).toBe(0);

    const snapshot: TerrainEditsSnapshot = JSON.parse(JSON.stringify(service.exportEdits()));
    expect(snapshot.seed).toBe(1337);

    const other = createTerrain();
    expect(other.service.importEdits({ ...snapshot, chunks: [{ coord: { x: 0, y: 0, z: 0 }, edits: [-1, 1, 0] }] })).toBe(false);
    expect(other.service.importEdits(snapshot)).toBe(true);
    await loadChunks(other.service, [{ x: 0, y: 0, z: 0 }]);
    expect(other.service.getVoxelBlock({ x: 4, y: surface + 1, z: 4 })).toEqual({ id: 6, metadata: 9 });

    // Import com o chunk já carregado regera com as edições.
    const third = createTerrain();
    await loadChunks(third.service, [{ x: 0, y: 0, z: 0 }]);
    expect(third.service.importEdits(snapshot)).toBe(true);
    await flush();
    third.service.update(1 / 60);
    expect(third.service.getVoxelBlock({ x: 4, y: surface + 1, z: 4 }).id).toBe(6);
  });
});

class NeverRespondingWorker {
  public terminated = false;
  public posted = 0;
  private errorListener: ((event: ErrorEvent) => void) | null = null;
  public addEventListener(type: string, listener: (event: never) => void): void {
    if (type === "error") {
      this.errorListener = listener as (event: ErrorEvent) => void;
    }
  }
  public postMessage(): void {
    this.posted += 1;
  }
  public terminate(): void {
    this.terminated = true;
  }
  public fail(): void {
    this.errorListener?.({ message: "load failed" } as ErrorEvent);
  }
}

describe("terrain gaps — G58 fila, orçamento e recuperação de Worker", () => {
  it("timeout gera localmente e reinicia o Worker travado", async () => {
    const workers: NeverRespondingWorker[] = [];
    const pool = new ProceduralWorkerPool(1, () => {
      const worker = new NeverRespondingWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    }, { jobTimeoutMs: 10, maxWorkerRestarts: 1 });
    const chunk = await pool.requestChunkGenerationAsync({ x: 0, y: 0, z: 0 }, 1337);
    expect(chunk.blocks.length).toBe(16 * 256 * 16);
    expect(pool.timeoutCount).toBe(1);
    expect(pool.fallbackCount).toBe(1);
    expect(workers[0]!.terminated).toBe(true);
    expect(workers).toHaveLength(2);
    // Segundo timeout esgota os reinícios: o slot sai e os jobs usam o fallback local.
    await pool.requestChunkGenerationAsync({ x: 1, y: 0, z: 0 }, 1337);
    expect(pool.workerCount).toBe(0);
    const third = await pool.requestChunkGenerationAsync({ x: 2, y: 0, z: 0 }, 1337);
    expect(third.coord.x).toBe(2);
    pool.clear();
  });

  it("Worker que falha ao carregar (erro sem job) não trava a fila; fila cancelável", async () => {
    const workers: NeverRespondingWorker[] = [];
    const pool = new ProceduralWorkerPool(1, () => {
      const worker = new NeverRespondingWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    }, { jobTimeoutMs: 60_000, maxWorkerRestarts: 0 });
    const first = pool.requestChunkGenerationAsync({ x: 0, y: 0, z: 0 }, 1337);
    const queued = pool.requestChunkGenerationAsync({ x: 1, y: 0, z: 0 }, 1337);
    const cancelled = pool.requestChunkGenerationAsync({ x: 2, y: 0, z: 0 }, 1337);
    expect(pool.cancelChunkGeneration({ x: 2, y: 0, z: 0 }, 1337)).toBe(true);
    await expect(cancelled).rejects.toThrow("cancelada");
    workers[0]!.fail();
    await expect(first).resolves.toMatchObject({ coord: { x: 0 } });
    await expect(queued).resolves.toMatchObject({ coord: { x: 1 } });
    expect(pool.workerCount).toBe(0);
    pool.clear();
  });

  it("montagem de malha orçada por update e cancelada no unload", async () => {
    const { service, render } = createTerrain();
    service.configure({ meshing: { maxMeshesPerUpdate: 1, budgetMs: 1000 } });
    service.requestChunk({ x: 0, y: 0, z: 0 });
    service.requestChunk({ x: 1, y: 0, z: 0 });
    service.requestChunk({ x: 2, y: 0, z: 0 });
    await flush();
    expect(service.getStats().queuedMeshes).toBe(3);
    service.update(1 / 60);
    expect(render.scene.size).toBe(1);
    service.unloadChunk({ x: 2, y: 0, z: 0 });
    service.unloadChunk({ x: 1, y: 0, z: 0 });
    expect(service.getStats().queuedMeshes).toBe(0);
    service.update(1 / 60);
    expect(render.scene.size).toBe(1);
  });
});

describe("terrain gaps — G59 metadata, água, contrato e bordas", () => {
  it("água transparente, metadata e sem faces escondidas nas bordas/fundo", async () => {
    const generator = new TerrainGenerator(1337);
    const lake = findColumn(generator, (height) => height < 12);
    const coord = { x: Math.floor(lake.x / 16), y: 0, z: Math.floor(lake.z / 16) };
    const { service, render } = createTerrain();
    await loadChunks(service, [coord, { x: coord.x + 1, y: 0, z: coord.z }]);
    expect(service.getVoxelBlock({ x: lake.x, y: 16, z: lake.z }).id).toBe(7);
    const object = render.scene.get(`chunk_${coord.x}:0:${coord.z}`)!;
    const water = object.children.find((child) => child.name.endsWith("_transparent")) as THREE.Mesh;
    expect(water).toBeDefined();
    expect((water.material as THREE.Material).transparent).toBe(true);
    expect((water.geometry.getAttribute("color") as THREE.BufferAttribute).itemSize).toBe(4);

    // Sem faces de parede/fundo enterradas: nenhum vértice opaco abaixo de y=3.
    const positions = opaqueGeometry(render, `chunk_${coord.x}:0:${coord.z}`).getAttribute("position");
    let minY = Number.POSITIVE_INFINITY;

    for (let i = 0; i < positions.count; i += 1) {
      minY = Math.min(minY, positions.getY(i));
    }

    expect(minY).toBeGreaterThan(3);

    // Metadata: escrita, leitura e validação.
    expect(service.modifyVoxelBlock({ worldPosition: { x: lake.x, y: 1, z: lake.z }, newBlockId: 2, newMetadata: 200 })).toBe(true);
    expect(service.getVoxelBlock({ x: lake.x, y: 1, z: lake.z })).toEqual({ id: 2, metadata: 200 });
    expect(service.modifyVoxelBlock({ worldPosition: { x: lake.x, y: 1, z: lake.z }, newBlockId: 2, newMetadata: 300 })).toBe(false);
  });

  it("collider ignora água (não sólida) e o fallback local é o mesmo gerador do Worker", () => {
    const manager = new VoxelChunkManager();
    const fromManager = manager.generateChunkData({ x: 3, y: 0, z: -2 });
    const fromGenerator = new TerrainGenerator(1337).generateChunk({ x: 3, y: 0, z: -2 });
    expect(fromManager.sizeY).toBe(256);
    expect(Array.from(fromManager.blocks)).toEqual(Array.from(fromGenerator.blocks));

    const palette = new BlockPalette();
    const chunk: ChunkDataMatrix = { coord: { x: 0, y: 0, z: 0 }, sizeX: 1, sizeY: 2, sizeZ: 1, blocks: new Uint8Array([2, 7]) };
    const compiled = GreedyMesher.compileChunkMesh(chunk, { palette, collision: true });
    // Collider só do bloco de pedra: 6 faces.
    expect(compiled.collisionIndices!.length).toBe(6 * 6);
    // Água: 5 faces (a de baixo encosta na pedra).
    expect(compiled.transparentIndices!.length).toBe(5 * 6);
    // Pedra: 6 faces (água não é opaca, então não oculta o topo da pedra).
    expect(compiled.indices.length).toBe(6 * 6);
  });
});

describe("terrain gaps — plugin", () => {
  it("declara game.physics e game.camera como consumidores opcionais", () => {
    const manifest = createTerrainPlugin().manifest;
    const consumes = manifest.capabilities?.consumes ?? [];
    expect(consumes.find((c) => c.id === PhysicsToken.id)?.optional).toBe(true);
    expect(consumes.find((c) => c.id === CameraToken.id)?.optional).toBe(true);
    expect(manifest.permissions?.capabilities).toEqual(expect.arrayContaining([PhysicsToken.id, CameraToken.id]));
    expect(manifest.dependsOn?.find((d) => d.id === "game.physics")?.optional).toBe(true);
    expect(manifest.permissions?.events).toEqual(expect.arrayContaining(["game.terrain.chunk-unloaded", "game.terrain.reset", "game.loop.render"]));
  });
});
