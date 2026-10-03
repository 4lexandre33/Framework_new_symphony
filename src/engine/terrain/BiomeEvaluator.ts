import type {
  BiomeDescriptor,
  Vector3Chunk,
} from "../../contracts/terrain/types";

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

export class BiomeEvaluator {
  private static readonly NOISE_SCALE =
    0.005;

  private readonly tempNoise:
    PerlinNoiseService;

  private readonly moistNoise:
    PerlinNoiseService;

  public constructor(
    seed = 1337,
  ) {
    this.tempNoise =
      new PerlinNoiseService(
        seed +
          101,
      );

    this.moistNoise =
      new PerlinNoiseService(
        seed +
          202,
      );
  }

  public reseed(
    seed: number,
  ): void {
    this.tempNoise.reseed(
      seed +
        101,
    );

    this.moistNoise.reseed(
      seed +
        202,
    );
  }

  public evaluateBiome(
    worldPos:
      Vector3Chunk,
  ): BiomeDescriptor {
    const temperature =
      this.normalizeNoise(
        this.tempNoise
          .noise2D(
            worldPos.x *
              BiomeEvaluator
                .NOISE_SCALE,

            worldPos.z *
              BiomeEvaluator
                .NOISE_SCALE,
          ),
      );

    const moisture =
      this.normalizeNoise(
        this.moistNoise
          .noise2D(
            worldPos.x *
              BiomeEvaluator
                .NOISE_SCALE,

            worldPos.z *
              BiomeEvaluator
                .NOISE_SCALE,
          ),
      );

    let bestBiome:
      BiomeDescriptor =
        FOREST_BIOME;

    let minimumDifference =
      Number.POSITIVE_INFINITY;

    for (
      let index = 0;
      index <
      DEFAULT_BIOMES.length;
      index += 1
    ) {
      const biome =
        DEFAULT_BIOMES[
          index
        ];

      if (!biome) {
        continue;
      }

      const temperatureDifference =
        biome.temperature -
        temperature;

      const moistureDifference =
        biome.moisture -
        moisture;

      const differenceSquared =
        temperatureDifference *
          temperatureDifference +
        moistureDifference *
          moistureDifference;

      if (
        differenceSquared <
        minimumDifference
      ) {
        minimumDifference =
          differenceSquared;

        bestBiome =
          biome;
      }
    }

    return bestBiome;
  }

  private normalizeNoise(
    noise: number,
  ): number {
    const normalized =
      (
        noise +
        1
      ) *
      0.5;

    return Math.min(
      1,
      Math.max(
        0,
        normalized,
      ),
    );
  }
}