// Harness em navegador real (Chromium) para terrain/streaming/ai:
// - Worker REAL de geração de terreno (terrain.worker.ts empacotado em Blob);
// - recuperação de Worker que falha ao carregar e de Worker travado (timeout);
// - render WebGL real dos chunks (cores por vértice, água transparente);
// - HLOD real reduzindo draw calls no WebGLRenderer.
// Empacotado por tests/browser/world-gaps.mjs (esbuild) e injetado na página.

import * as THREE from "three";

import type { PluginContext } from "@core";

import { ProceduralWorkerPool } from "../../src/engine/terrain/internal/ProceduralWorkerPool";
import { TerrainGenerator } from "../../src/engine/terrain/internal/TerrainGenerator";
import { TerrainService } from "../../src/engine/terrain/internal/TerrainService";
import { VoxelChunkManager } from "../../src/engine/terrain/internal/VoxelChunkManager";
import { StreamingService } from "../../src/engine/streaming/internal/StreamingService";
import type { Render3DApi } from "../../src/tokens/render";

type Result = Record<string, unknown>;

declare global {
  interface Window {
    __terrainWorkerUrl: string;
    worldGaps: Record<string, () => Promise<Result>>;
  }
}

const emitted: Array<[string, unknown]> = [];
const ctx = {
  events: {
    emit(type: string, payload: unknown): void {
      emitted.push([type, payload]);
    },
  },
  log: { debug(): void {}, info(): void {}, warn(): void {}, error(): void {} },
} as unknown as PluginContext;

function createScene(): { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; render: Render3DApi; objects: Map<string, THREE.Object3D> } {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 240;
  document.body.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
  renderer.setSize(320, 240, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.add(new THREE.AmbientLight(0xffffff, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(1, 2, 1);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(60, 320 / 240, 0.1, 2000);
  const objects = new Map<string, THREE.Object3D>();
  const render = {
    addMeshToScene(key: string, object: THREE.Object3D): void {
      const previous = objects.get(key);

      if (previous && previous !== object) {
        scene.remove(previous);
      }

      objects.set(key, object);
      scene.add(object);
    },
    removeMeshFromScene(key: string): void {
      const object = objects.get(key);

      if (object) {
        scene.remove(object);
        objects.delete(key);
      }
    },
    getMeshFromScene(key: string): THREE.Object3D | null {
      return objects.get(key) ?? null;
    },
  } as unknown as Render3DApi;
  return { renderer, scene, camera, render, objects };
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const start = performance.now();

  while (performance.now() - start < timeoutMs) {
    if (predicate()) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  return predicate();
}

function sampleColors(renderer: THREE.WebGLRenderer): { distinct: number; nonBlack: number } {
  const gl = renderer.getContext();
  const pixels = new Uint8Array(320 * 240 * 4);
  gl.readPixels(0, 0, 320, 240, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const colors = new Set<string>();
  let nonBlack = 0;

  for (let i = 0; i < pixels.length; i += 4 * 7) {
    const r = pixels[i] as number;
    const g = pixels[i + 1] as number;
    const b = pixels[i + 2] as number;

    if (r + g + b > 30) {
      nonBlack += 1;
      colors.add(`${r >> 4},${g >> 4},${b >> 4}`);
    }
  }

  return { distinct: colors.size, nonBlack };
}

window.worldGaps = {
  /** Worker real: gera e o resultado bate com o gerador do main thread. */
  async realWorker(): Promise<Result> {
    const pool = new ProceduralWorkerPool(2, () => new Worker(window.__terrainWorkerUrl), { jobTimeoutMs: 20000 });
    const started = performance.now();
    const chunks = await Promise.all([
      pool.requestChunkGenerationAsync({ x: 0, y: 0, z: 0 }, 1337),
      pool.requestChunkGenerationAsync({ x: 5, y: 0, z: -3 }, 1337),
      pool.requestChunkGenerationAsync({ x: -7, y: 0, z: 2 }, 1337),
    ]);
    const elapsed = performance.now() - started;
    const reference = new TerrainGenerator(1337).generateChunk({ x: 5, y: 0, z: -3 });
    let equal = chunks[1]!.blocks.length === reference.blocks.length;

    for (let i = 0; equal && i < reference.blocks.length; i += 1) {
      equal = chunks[1]!.blocks[i] === reference.blocks[i];
    }

    const result = {
      sizeY: chunks[0]!.sizeY,
      length: chunks[0]!.blocks.length,
      equalToMainThread: equal,
      fallbacks: pool.fallbackCount,
      workers: pool.workerCount,
      elapsedMs: Math.round(elapsed),
    };
    pool.clear();
    return result;
  },

  /** Worker que falha ao carregar (erro sem job) e Worker que trava (timeout). */
  async brokenWorkers(): Promise<Result> {
    const brokenUrl = URL.createObjectURL(new Blob(["throw new Error('boom on load');"], { type: "text/javascript" }));
    const hangingUrl = URL.createObjectURL(new Blob(["self.onmessage = function () {};"], { type: "text/javascript" }));
    const broken = new ProceduralWorkerPool(1, () => new Worker(brokenUrl), { maxWorkerRestarts: 1, jobTimeoutMs: 20000 });
    const brokenStart = performance.now();
    const brokenChunk = await broken.requestChunkGenerationAsync({ x: 1, y: 0, z: 1 }, 1337);
    const brokenMs = performance.now() - brokenStart;
    // O Worker reiniciado também falha ao carregar: o slot é descartado e os
    // próximos jobs vão direto para o gerador local (não ficam na fila para sempre).
    await waitFor(() => broken.workerCount === 0, 2000);
    const second = await broken.requestChunkGenerationAsync({ x: 3, y: 0, z: 3 }, 1337);
    const brokenResult = { length: brokenChunk.blocks.length, secondLength: second.blocks.length, fallbacks: broken.fallbackCount, workers: broken.workerCount, restarts: broken.restartCount, ms: Math.round(brokenMs) };
    broken.clear();

    const hanging = new ProceduralWorkerPool(1, () => new Worker(hangingUrl), { maxWorkerRestarts: 1, jobTimeoutMs: 150 });
    const hangStart = performance.now();
    const hungChunk = await hanging.requestChunkGenerationAsync({ x: 2, y: 0, z: 2 }, 1337);
    const hangMs = performance.now() - hangStart;
    const hangingResult = { length: hungChunk.blocks.length, timeouts: hanging.timeoutCount, restarts: hanging.restartCount, ms: Math.round(hangMs) };
    hanging.clear();
    return { broken: brokenResult, hanging: hangingResult };
  },

  /** TerrainService completo com Worker real + render WebGL real. */
  async terrainRender(): Promise<Result> {
    const { renderer, scene, camera, render, objects } = createScene();
    const pool = new ProceduralWorkerPool(2, () => new Worker(window.__terrainWorkerUrl));
    const service = new TerrainService(ctx, new VoxelChunkManager(), pool);
    service.bindDependencies(render, null, null);
    service.configure({
      streaming: { enabled: true, radiusChunks: 2, maxRequestsPerUpdate: 64 },
      meshing: { maxMeshesPerUpdate: 64, budgetMs: 1000 },
    });
    // Coluna com lago (água) por perto, para checar a malha transparente.
    const generator = new TerrainGenerator(1337);
    const sample = { height: 0, biome: null as never, tintR: 0, tintG: 0, tintB: 0 };
    let lakeX = 0;
    let lakeZ = 0;

    outer: for (let z = -1500; z < 1500; z += 16) {
      for (let x = -1500; x < 1500; x += 16) {
        if (generator.sampleColumn(x, z, sample).height < 12) {
          lakeX = x;
          lakeZ = z;
          break outer;
        }
      }
    }

    service.update(1 / 60, { x: lakeX, y: 0, z: lakeZ });
    const ready = await waitFor(() => {
      service.update(1 / 60);
      return service.getStats().renderedChunks >= 13;
    }, 20000);
    const stats = service.getStats();
    let transparentMeshes = 0;
    let coloredMeshes = 0;

    for (const object of objects.values()) {
      for (const child of object.children) {
        const mesh = child as THREE.Mesh;

        if ((mesh.material as THREE.Material).transparent) transparentMeshes += 1;
        if (mesh.geometry.getAttribute("color")) coloredMeshes += 1;
      }
    }

    const height = service.getSurfaceHeight(lakeX, lakeZ);
    camera.position.set(lakeX - 30, Math.max(40, height + 35), lakeZ - 30);
    camera.lookAt(lakeX + 8, height, lakeZ + 8);
    renderer.render(scene, camera);
    const colors = sampleColors(renderer);
    const calls = renderer.info.render.calls;
    const glError = renderer.getContext().getError();
    const fallbacks = pool.fallbackCount;
    service.dispose();
    renderer.dispose();
    return { ready, stats, transparentMeshes, coloredMeshes, colors, calls, glError, fallbacks, chunkGenerated: emitted.filter(([t]) => t === "game.terrain.chunk-generated").length };
  },

  /** HLOD real: o proxy fundido reduz draw calls no WebGL. */
  async hlod(): Promise<Result> {
    const { renderer, scene, camera, render } = createScene();
    const streaming = new StreamingService(ctx);
    streaming.bindDependencies({ render });
    streaming.setStreamingRadius(50, 5);
    streaming.registerSector({ sectorCoord: { x: 0, y: 0, z: 0 }, boundsMin: { x: -20, y: -5, z: -20 }, boundsMax: { x: 20, y: 5, z: 20 }, assetUrls: [] });
    const material = new THREE.MeshLambertMaterial({ color: 0x88aa55 });
    const keys: string[] = [];

    for (let i = 0; i < 40; i += 1) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1 + (i % 3), 1), material);
      mesh.position.set((i % 8) * 3 - 12, 0, Math.floor(i / 8) * 3 - 6);
      mesh.rotation.y = i * 0.3;
      render.addMeshToScene(`prop_${i}`, mesh);
      keys.push(`prop_${i}`);
    }

    streaming.updateStreamingCenter({ x: 0, y: 0, z: 0 });
    const result = streaming.buildHLOD({ x: 0, y: 0, z: 0 }, keys);
    camera.position.set(0, 60, 120);
    camera.lookAt(0, 0, 0);
    streaming.update({ x: 0, y: 0, z: 0 }, 0.016);
    renderer.render(scene, camera);
    const nearCalls = renderer.info.render.calls;
    const nearColors = sampleColors(renderer);
    streaming.update({ x: 0, y: 0, z: 200 }, 0.016);
    renderer.render(scene, camera);
    const farCalls = renderer.info.render.calls;
    const farColors = sampleColors(renderer);
    const active = streaming.isHLODActive({ x: 0, y: 0, z: 0 });
    const stats = streaming.getHLODStats();
    streaming.dispose();
    renderer.dispose();
    return { result, nearCalls, farCalls, active, stats, nearPixels: nearColors.nonBlack, farPixels: farColors.nonBlack };
  },
};
