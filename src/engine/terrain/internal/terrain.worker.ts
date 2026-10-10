import type {
  ChunkDataMatrix,
  Vector3Chunk,
} from "../../../contracts/terrain/types";

import {
  DEFAULT_GENERATION_CONFIG,
  TerrainGenerator,
  type ResolvedGenerationConfig,
} from "./TerrainGenerator";

interface TerrainWorkerRequest {
  readonly jobId: number;
  readonly coord: Vector3Chunk;
  readonly seed: number;
  readonly config?: ResolvedGenerationConfig;
}

interface TerrainWorkerResponse {
  readonly jobId: number;
  readonly chunk?: ChunkDataMatrix;
  readonly error?: string;
}

interface TerrainWorkerScope {
  onmessage: ((event: MessageEvent<TerrainWorkerRequest>) => void) | null;
  postMessage(message: TerrainWorkerResponse, transfer: Transferable[]): void;
}

const workerScope = self as unknown as TerrainWorkerScope;

/**
 * Geração procedural por seed (TerrainGenerator = PerlinNoiseService +
 * BiomeEvaluator), o mesmo código usado no fallback do pool.
 * Reaproveita o gerador entre jobs da mesma seed/config (mesmo código do main thread). */
let cachedGenerator: TerrainGenerator | null = null;

function generatorFor(seed: number, config: ResolvedGenerationConfig): TerrainGenerator {
  if (cachedGenerator === null) {
    cachedGenerator = new TerrainGenerator(seed, config);
    return cachedGenerator;
  }

  if (cachedGenerator.getSeed() !== seed) {
    cachedGenerator.reseed(seed);
  }

  cachedGenerator.setConfig(config);
  return cachedGenerator;
}

workerScope.onmessage = (event: MessageEvent<TerrainWorkerRequest>): void => {
  const { jobId, coord, seed, config } = event.data;

  try {
    const chunk = generatorFor(seed, config ?? DEFAULT_GENERATION_CONFIG).generateChunk(coord);
    const transferBuffer = chunk.blocks.buffer as ArrayBuffer;
    workerScope.postMessage({ jobId, chunk }, [transferBuffer]);
  } catch (error: unknown) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    workerScope.postMessage({ jobId, error: message }, []);
  }
};
