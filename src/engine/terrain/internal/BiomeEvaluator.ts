import type {
  BiomeDescriptor,
  Vector3Chunk,
} from "../../../contracts/terrain/types";

import {
  PerlinNoiseService,
} from "./PerlinNoiseService";

const DESERT_BIOME:
  BiomeDescriptor = {
    biomeId:
      "desert",

    name:
      "Deserto",

    surfaceBlockId:
      4,

    subSurfaceBlockId:
      4,

    minHeight:
      10,

    maxHeight:
      40,

    temperature:
      0.9,

    moisture:
      0.1,
  };

const FOREST_BIOME:
  BiomeDescriptor = {
    biomeId:
      "forest",

    name:
      "Floresta",

    surfaceBlockId:
      3,

    subSurfaceBlockId:
      1,

    minHeight:
      20,

    maxHeight:
      80,

    temperature:
      0.5,

    moisture:
      0.6,
  };

const TUNDRA_BIOME:
  BiomeDescriptor = {
    biomeId:
      "tundra",

    name:
      "Tundra / Neve",

    surfaceBlockId:
      5,

    subSurfaceBlockId:
      2,

    minHeight:
      60,

    maxHeight:
      120,

    temperature:
      0.1,

    moisture:
      0.4,
  };

const MOUNTAINS_BIOME:
  BiomeDescriptor = {
    biomeId:
      "mountains",

    name:
      "Montanhas Rochosas",

    surfaceBlockId:
      2,

    subSurfaceBlockId:
      2,

    minHeight:
      80,

    maxHeight:
      200,

    temperature:
      0.2,

    moisture:
      0.2,
  };

export const DEFAULT_BIOMES:
  ReadonlyArray<BiomeDescriptor> =
    Object.freeze([
      DESERT_BIOME,
      FOREST_BIOME,
      TUNDRA_BIOME,
      MOUNTAINS_BIOME,
    ]);

/** Ajuste interno: estica temperatura/umidade (sem isso ~61% era floresta) e largura da mistura gaussiana entre biomas (G57). */
export const BIOME_BLEND_TUNING = { climateStretch: 2.6, blendSigma: 0.3 };

export class BiomeEvaluator {
  private static readonly NOISE_SCALE = 0.005;

  private readonly tempNoise: PerlinNoiseService;
  private readonly moistNoise: PerlinNoiseService;

  public constructor(seed = 1337) {
    this.tempNoise = new PerlinNoiseService(seed + 101);
    this.moistNoise = new PerlinNoiseService(seed + 202);
  }

  public reseed(seed: number): void {
    this.tempNoise.reseed(seed + 101);
    this.moistNoise.reseed(seed + 202);
  }

  /** Bioma dominante (maior peso) na coluna. */
  public evaluateBiome(worldPos: Vector3Chunk): BiomeDescriptor {
    return this.dominantBiome(worldPos.x, worldPos.z);
  }

  public dominantBiome(worldX: number, worldZ: number): BiomeDescriptor {
    const temperature = this.sampleTemperature(worldX, worldZ);
    const moisture = this.sampleMoisture(worldX, worldZ);
    let bestBiome: BiomeDescriptor = FOREST_BIOME;
    let minimumDifference = Number.POSITIVE_INFINITY;

    for (let index = 0; index < DEFAULT_BIOMES.length; index += 1) {
      const biome = DEFAULT_BIOMES[index];

      if (!biome) {
        continue;
      }

      const dt = biome.temperature - temperature;
      const dm = biome.moisture - moisture;
      const differenceSquared = dt * dt + dm * dm;

      if (differenceSquared < minimumDifference) {
        minimumDifference = differenceSquared;
        bestBiome = biome;
      }
    }

    return bestBiome;
  }

  /**
   * Pesos normalizados (soma 1) de cada bioma de `DEFAULT_BIOMES` na coluna,
   * escritos em `out` (comprimento >= DEFAULT_BIOMES.length). Retorna o índice
   * do bioma dominante. Contínuo no espaço => alturas sem paredes (G57).
   */
  public evaluateWeights(worldX: number, worldZ: number, out: Float64Array): number {
    const temperature = this.sampleTemperature(worldX, worldZ);
    const moisture = this.sampleMoisture(worldX, worldZ);
    const inverseSigmaSquared = 1 / (BIOME_BLEND_TUNING.blendSigma * BIOME_BLEND_TUNING.blendSigma);
    let minimumDistance = Number.POSITIVE_INFINITY;
    let dominant = 0;

    for (let index = 0; index < DEFAULT_BIOMES.length; index += 1) {
      const biome = DEFAULT_BIOMES[index] as BiomeDescriptor;
      const dt = biome.temperature - temperature;
      const dm = biome.moisture - moisture;
      const distanceSquared = dt * dt + dm * dm;
      out[index] = distanceSquared;

      if (distanceSquared < minimumDistance) {
        minimumDistance = distanceSquared;
        dominant = index;
      }
    }

    let total = 0;

    for (let index = 0; index < DEFAULT_BIOMES.length; index += 1) {
      // Subtrai o mínimo antes do exp para estabilidade numérica.
      const weight = Math.exp(-((out[index] as number) - minimumDistance) * inverseSigmaSquared);
      out[index] = weight;
      total += weight;
    }

    const inverseTotal = total > 0 ? 1 / total : 0;

    for (let index = 0; index < DEFAULT_BIOMES.length; index += 1) {
      out[index] = (out[index] as number) * inverseTotal;
    }

    return dominant;
  }

  private sampleTemperature(worldX: number, worldZ: number): number {
    return this.normalizeNoise(
      this.tempNoise.noise2D(worldX * BiomeEvaluator.NOISE_SCALE, worldZ * BiomeEvaluator.NOISE_SCALE),
    );
  }

  private sampleMoisture(worldX: number, worldZ: number): number {
    return this.normalizeNoise(
      this.moistNoise.noise2D(worldX * BiomeEvaluator.NOISE_SCALE, worldZ * BiomeEvaluator.NOISE_SCALE),
    );
  }

  private normalizeNoise(noise: number): number {
    const normalized = 0.5 + noise * 0.5 * BIOME_BLEND_TUNING.climateStretch;
    return Math.min(1, Math.max(0, normalized));
  }
}
