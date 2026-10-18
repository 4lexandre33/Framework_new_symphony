import type {
  BiomeDescriptor,
  ChunkDataMatrix,
  TerrainGenerationOptions,
  Vector3Chunk,
} from "../../../contracts/terrain/types";

import {
  BiomeEvaluator,
  DEFAULT_BIOMES,
} from "./BiomeEvaluator";

import {
  PerlinNoiseService,
} from "./PerlinNoiseService";

export const CHUNK_SIZE_X = 16;
export const CHUNK_SIZE_Y = 256;
export const CHUNK_SIZE_Z = 16;

export const BLOCK_AIR = 0;
export const BLOCK_STONE = 2;
export const BLOCK_WATER = 7;

/** Configuração serializável (vai para o Worker). */
export interface ResolvedGenerationConfig {
  readonly seaLevel: number;
  readonly caves: boolean;
  readonly caveThreshold: number;
}

/** G133: água é opt-in (`seaLevel` ≥ 0); o padrão -1 não gera água. */
export const DEFAULT_GENERATION_CONFIG: ResolvedGenerationConfig = Object.freeze({
  seaLevel: -1,
  caves: false,
  caveThreshold: 0.42,
});

export function resolveGenerationConfig(
  options: TerrainGenerationOptions | undefined,
  base: ResolvedGenerationConfig = DEFAULT_GENERATION_CONFIG,
): ResolvedGenerationConfig {
  const seaLevel = options?.seaLevel;
  const caveThreshold = options?.caveThreshold;

  return Object.freeze({
    seaLevel:
      typeof seaLevel === "number" && Number.isFinite(seaLevel)
        ? Math.trunc(seaLevel)
        : base.seaLevel,
    caves: typeof options?.caves === "boolean" ? options.caves : base.caves,
    caveThreshold:
      typeof caveThreshold === "number" && Number.isFinite(caveThreshold)
        ? caveThreshold
        : base.caveThreshold,
  });
}

export function normalizeTerrainSeed(seed: number): number {
  return Number.isFinite(seed) ? Math.trunc(seed) : 1337;
}

/** Resultado (reutilizado) da amostragem de uma coluna. */
export interface ColumnSample {
  height: number;
  biome: BiomeDescriptor;
  /** Tom RGB misturado entre biomas (0–1). */
  tintR: number;
  tintG: number;
  tintB: number;
}

const DEFAULT_BIOME_TINTS: Readonly<Record<string, number>> = Object.freeze({
  desert: 0xc8c070,
  forest: 0x5a9a3c,
  tundra: 0x9fb8a8,
  mountains: 0x7f9a6a,
});

/**
 * Gerador procedural puro e determinístico (mesmo código no Worker, no
 * fallback do pool e no main thread).
 *
 * - Altura misturada entre biomas por pesos gaussianos (G57: sem paredes).
 * - Coluna inteira até 255 (G54: montanhas até 200 sem platô).
 * - Água até `seaLevel`, cavernas opcionais por ruído 3D (G59).
 */
export class TerrainGenerator {
  private readonly noise: PerlinNoiseService;
  private readonly caveNoise: PerlinNoiseService;
  private readonly biomes: BiomeEvaluator;
  private readonly weights = new Float64Array(DEFAULT_BIOMES.length);
  private readonly tintTable = new Float32Array(DEFAULT_BIOMES.length * 3);
  private seed: number;

  public constructor(
    seed = 1337,
    private config: ResolvedGenerationConfig = DEFAULT_GENERATION_CONFIG,
    biomeTints?: Readonly<Record<string, number>>,
  ) {
    this.seed = normalizeTerrainSeed(seed);
    this.noise = new PerlinNoiseService(this.seed);
    this.caveNoise = new PerlinNoiseService(this.seed + 303);
    this.biomes = new BiomeEvaluator(this.seed);
    this.setBiomeTints(biomeTints);
  }

  public getSeed(): number {
    return this.seed;
  }

  public getConfig(): ResolvedGenerationConfig {
    return this.config;
  }

  public setConfig(config: ResolvedGenerationConfig): void {
    this.config = config;
  }

  public reseed(seed: number): void {
    this.seed = normalizeTerrainSeed(seed);
    this.noise.reseed(this.seed);
    this.caveNoise.reseed(this.seed + 303);
    this.biomes.reseed(this.seed);
  }

  public setBiomeTints(tints: Readonly<Record<string, number>> | undefined): void {
    for (let index = 0; index < DEFAULT_BIOMES.length; index += 1) {
      const biome = DEFAULT_BIOMES[index] as BiomeDescriptor;
      const color = tints?.[biome.biomeId] ?? DEFAULT_BIOME_TINTS[biome.biomeId] ?? 0xffffff;
      this.tintTable[index * 3] = ((color >> 16) & 0xff) / 255;
      this.tintTable[index * 3 + 1] = ((color >> 8) & 0xff) / 255;
      this.tintTable[index * 3 + 2] = (color & 0xff) / 255;
    }
  }

  /**
   * Bloco igual em TODAS as colunas na altura `worldY` (atalho para bordas
   * verticais), ou -1 se depende da coluna.
   */
  public uniformBlockAtY(worldY: number): number {
    if (worldY >= CHUNK_SIZE_Y && worldY > this.config.seaLevel) {
      return BLOCK_AIR;
    }

    let minimumHeight = Number.POSITIVE_INFINITY;

    for (let index = 0; index < DEFAULT_BIOMES.length; index += 1) {
      minimumHeight = Math.min(minimumHeight, (DEFAULT_BIOMES[index] as BiomeDescriptor).minHeight);
    }

    // Abaixo de altura-3 é sempre pedra; cavernas só cortam acima de y=2.
    if (worldY < minimumHeight - 3 && (!this.config.caves || worldY <= 2)) {
      return BLOCK_STONE;
    }

    return -1;
  }

  public getBiomeAt(worldX: number, worldZ: number): BiomeDescriptor {
    return this.biomes.dominantBiome(Math.floor(worldX), Math.floor(worldZ));
  }

  /** Altura da superfície (bloco mais alto do terreno gerado, sem edições). */
  public sampleColumn(worldX: number, worldZ: number, out: ColumnSample): ColumnSample {
    const weights = this.weights;
    const dominant = this.biomes.evaluateWeights(worldX, worldZ, weights);
    let minHeight = 0;
    let maxHeight = 0;
    let tintR = 0;
    let tintG = 0;
    let tintB = 0;

    for (let index = 0; index < DEFAULT_BIOMES.length; index += 1) {
      const biome = DEFAULT_BIOMES[index] as BiomeDescriptor;
      const weight = weights[index] as number;
      minHeight += biome.minHeight * weight;
      maxHeight += biome.maxHeight * weight;
      tintR += (this.tintTable[index * 3] as number) * weight;
      tintG += (this.tintTable[index * 3 + 1] as number) * weight;
      tintB += (this.tintTable[index * 3 + 2] as number) * weight;
    }

    const rawHeightNoise = this.noise.fractalNoise2D(worldX * 0.01, worldZ * 0.01, 4, 0.5, 2);
    const normalized = Math.min(1, Math.max(0, (rawHeightNoise + 1) * 0.5));
    const height = Math.floor(minHeight + normalized * (maxHeight - minHeight));

    out.height = Math.min(CHUNK_SIZE_Y - 1, height);
    out.biome = DEFAULT_BIOMES[dominant] as BiomeDescriptor;
    out.tintR = tintR;
    out.tintG = tintG;
    out.tintB = tintB;
    return out;
  }

  /**
   * Preenche `count` blocos da coluna (worldX, worldZ) a partir de `worldYStart`
   * em `out[offset + i * stride]`.
   */
  public fillColumn(
    worldX: number,
    worldZ: number,
    worldYStart: number,
    count: number,
    out: Uint8Array,
    offset: number,
    stride: number,
    sample: ColumnSample,
  ): void {
    this.sampleColumn(worldX, worldZ, sample);
    const terrainHeight = sample.height;
    const surfaceId = sample.biome.surfaceBlockId;
    const subSurfaceId = sample.biome.subSurfaceBlockId;
    const seaLevel = this.config.seaLevel;
    const caves = this.config.caves;
    const caveThreshold = this.config.caveThreshold;

    for (let index = 0; index < count; index += 1) {
      const worldY = worldYStart + index;
      let block = BLOCK_AIR;

      if (worldY === terrainHeight) {
        // Superfície submersa vira areia (fundo de lago).
        block = worldY < seaLevel && surfaceId !== 5 ? 4 : surfaceId;
      } else if (worldY < terrainHeight && worldY >= terrainHeight - 3) {
        block = subSurfaceId;
      } else if (worldY < terrainHeight - 3) {
        block = BLOCK_STONE;
      } else if (worldY <= seaLevel && worldY >= 0) {
        block = BLOCK_WATER;
      }

      if (
        caves &&
        block !== BLOCK_AIR &&
        block !== BLOCK_WATER &&
        worldY > 2 &&
        worldY < terrainHeight - 4 &&
        this.caveNoise.noise3D(worldX * 0.06, worldY * 0.08, worldZ * 0.06) > caveThreshold
      ) {
        block = BLOCK_AIR;
      }

      out[offset + index * stride] = block;
    }
  }

  public generateChunk(coord: Vector3Chunk): ChunkDataMatrix {
    const blocks = new Uint8Array(CHUNK_SIZE_X * CHUNK_SIZE_Y * CHUNK_SIZE_Z);
    const sample = createColumnSample();
    const worldOffsetX = coord.x * CHUNK_SIZE_X;
    const worldOffsetY = coord.y * CHUNK_SIZE_Y;
    const worldOffsetZ = coord.z * CHUNK_SIZE_Z;
    const stride = CHUNK_SIZE_X * CHUNK_SIZE_Z;

    for (let localZ = 0; localZ < CHUNK_SIZE_Z; localZ += 1) {
      for (let localX = 0; localX < CHUNK_SIZE_X; localX += 1) {
        this.fillColumn(
          worldOffsetX + localX,
          worldOffsetZ + localZ,
          worldOffsetY,
          CHUNK_SIZE_Y,
          blocks,
          localX + CHUNK_SIZE_X * localZ,
          stride,
          sample,
        );
      }
    }

    return {
      coord: { x: coord.x, y: coord.y, z: coord.z },
      sizeX: CHUNK_SIZE_X,
      sizeY: CHUNK_SIZE_Y,
      sizeZ: CHUNK_SIZE_Z,
      blocks,
    };
  }
}

export function createColumnSample(): ColumnSample {
  return {
    height: 0,
    biome: DEFAULT_BIOMES[1] as BiomeDescriptor,
    tintR: 1,
    tintG: 1,
    tintB: 1,
  };
}
