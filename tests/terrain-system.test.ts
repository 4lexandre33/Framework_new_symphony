import {
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import type {
  ChunkDataMatrix,
} from "../src/contracts/terrain/types";

import {
  BiomeEvaluator,
} from "../src/engine/terrain/internal/BiomeEvaluator";

import {
  GreedyMesher,
} from "../src/engine/terrain/internal/GreedyMesher";

import {
  PerlinNoiseService,
} from "../src/engine/terrain/internal/PerlinNoiseService";

import {
  ProceduralWorkerPool,
} from "../src/engine/terrain/internal/ProceduralWorkerPool";

import {
  VoxelChunkManager,
} from "../src/engine/terrain/internal/VoxelChunkManager";

import {
  createTerrainPlugin,
} from "../src/plugins/terrain/plugin";

import {
  RenderToken,
} from "../src/tokens/render";

import {
  TerrainToken,
} from "../src/tokens/terrain";

describe(
  "Camada de Terreno Procedural, Biomas & Voxels (game.terrain)",
  (): void => {
    let noiseService:
      PerlinNoiseService;

    let biomeEvaluator:
      BiomeEvaluator;

    let chunkManager:
      VoxelChunkManager;

    beforeEach(
      (): void => {
        noiseService =
          new PerlinNoiseService(
            1337,
          );

        biomeEvaluator =
          new BiomeEvaluator(
            1337,
          );

        chunkManager =
          new VoxelChunkManager();
      },
    );

    it(
      "deve gerar valores de ruído Perlin determinísticos baseados em Seed",
      (): void => {
        const coordinates = [
          [
            10.5,
            20.5,
          ],

          [
            -3.25,
            91.125,
          ],

          [
            123.75,
            -18.5,
          ],
        ] as const;

        const firstSeedValues =
          coordinates.map(
            (
              [
                x,
                y,
              ],
            ): number =>
              noiseService
                .noise2D(
                  x,
                  y,
                ),
          );

        const repeatedValues =
          coordinates.map(
            (
              [
                x,
                y,
              ],
            ): number =>
              noiseService
                .noise2D(
                  x,
                  y,
                ),
          );

        expect(
          repeatedValues,
        ).toEqual(
          firstSeedValues,
        );

        const differentSeed =
          new PerlinNoiseService(
            9999,
          );

        const secondSeedValues =
          coordinates.map(
            (
              [
                x,
                y,
              ],
            ): number =>
              differentSeed
                .noise2D(
                  x,
                  y,
                ),
          );

        expect(
          secondSeedValues,
        ).not.toEqual(
          firstSeedValues,
        );
      },
    );

    it(
      "deve aceitar seeds zero e negativas sem produzir NaN",
      (): void => {
        const zeroSeed =
          new PerlinNoiseService(
            0,
          );

        const negativeSeed =
          new PerlinNoiseService(
            -12345,
          );

        expect(
          Number.isFinite(
            zeroSeed.noise2D(
              4.2,
              9.7,
            ),
          ),
        ).toBe(
          true,
        );

        expect(
          Number.isFinite(
            negativeSeed
              .noise2D(
                4.2,
                9.7,
              ),
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "deve avaliar e atribuir um bioma válido para uma coordenada do mundo",
      (): void => {
        const biome =
          biomeEvaluator
            .evaluateBiome({
              x: 0,
              y: 0,
              z: 0,
            });

        expect(
          biome.biomeId,
        ).toBeTypeOf(
          "string",
        );

        expect(
          biome.surfaceBlockId,
        ).toBeGreaterThan(
          0,
        );

        expect(
          biome.minHeight,
        ).toBeLessThanOrEqual(
          biome.maxHeight,
        );
      },
    );

    it(
      "deve executar Greedy Meshing real e fundir faces adjacentes",
      (): void => {
        /*
         * Dois voxels sólidos lado a lado.
         *
         * Sem greedy:
         * 10 quads externos.
         *
         * Com greedy:
         * 6 quads retangulares.
         */
        const chunk:
          ChunkDataMatrix = {
            coord: {
              x: 0,
              y: 0,
              z: 0,
            },

            sizeX:
              2,

            sizeY:
              1,

            sizeZ:
              1,

            blocks:
              new Uint8Array([
                1,
                1,
              ]),
          };

        const compiled =
          GreedyMesher
            .compileChunkMesh(
              chunk,
            );

        expect(
          compiled.positions.length,
        ).toBe(
          6 *
          4 *
          3,
        );

        expect(
          compiled.normals.length,
        ).toBe(
          compiled.positions
            .length,
        );

        expect(
          compiled.uvs.length,
        ).toBe(
          6 *
          4 *
          2,
        );

        expect(
          compiled.indices.length,
        ).toBe(
          6 *
          6,
        );
      },
    );

    it(
      "deve compilar um Chunk procedural completo em buffers válidos para Three.js",
      (): void => {
        const chunkData =
          chunkManager
            .generateChunkData({
              x: 0,
              y: 0,
              z: 0,
            });

        const compiled =
          GreedyMesher
            .compileChunkMesh(
              chunkData,
            );

        expect(
          compiled.positions
            .length,
        ).toBeGreaterThan(
          0,
        );

        expect(
          compiled.normals
            .length,
        ).toBe(
          compiled.positions
            .length,
        );

        expect(
          compiled.uvs
            .length %
            2,
        ).toBe(
          0,
        );

        expect(
          compiled.indices
            .length,
        ).toBeGreaterThan(
          0,
        );
      },
    );

    it(
      "deve alterar voxels e consultar corretamente chunks negativos no eixo Y",
      (): void => {
        chunkManager
          .generateChunkData({
            x: 0,
            y: -1,
            z: 0,
          });

        const targetPosition = {
          x: 5,
          y: -1,
          z: 5,
        };

        const modified =
          chunkManager
            .modifyVoxelBlock({
              worldPosition:
                targetPosition,

              newBlockId:
                6,
            });

        expect(
          modified,
        ).toBe(
          true,
        );

        expect(
          chunkManager
            .getVoxelBlock(
              targetPosition,
            )
            .id,
        ).toBe(
          6,
        );
      },
    );

    it(
      "deve invalidar chunks antigos quando a seed global do terreno mudar",
      (): void => {
        const firstChunk =
          chunkManager
            .generateChunkData({
              x: 0,
              y: 0,
              z: 0,
            });

        const firstBlocks =
          new Uint8Array(
            firstChunk.blocks,
          );

        expect(
          chunkManager
            .getActiveChunkCount(),
        ).toBe(
          1,
        );

        chunkManager.setSeed(
          9999,
        );

        expect(
          chunkManager
            .getActiveChunkCount(),
        ).toBe(
          0,
        );

        const secondChunk =
          chunkManager
            .generateChunkData({
              x: 0,
              y: 0,
              z: 0,
            });

        let foundDifference =
          false;

        for (
          let index = 0;
          index <
          firstBlocks.length;
          index += 1
        ) {
          if (
            firstBlocks[
              index
            ] !==
            secondChunk.blocks[
              index
            ]
          ) {
            foundDifference =
              true;

            break;
          }
        }

        expect(
          foundDifference,
        ).toBe(
          true,
        );
      },
    );

    it(
      "deve gerar chunk assíncrono usando fallback quando Workers estiverem desativados",
      async (): Promise<void> => {
        const workerPool =
          new ProceduralWorkerPool(
            0,
          );

        const chunk =
          await workerPool
            .requestChunkGenerationAsync(
              {
                x: 0,
                y: 0,
                z: 0,
              },
              1337,
            );

        expect(
          chunk.blocks.length,
        ).toBe(
          16 *
          128 *
          16,
        );

        expect(
          workerPool
            .activeWorkerCount,
        ).toBe(
          0,
        );

        workerPool.clear();
      },
    );

    it(
      "deve declarar corretamente TerrainToken, game.loop e game.render no manifesto",
      (): void => {
        const plugin =
          createTerrainPlugin();

        const provided =
          plugin.manifest
            .capabilities
            ?.provides ??
          [];

        const consumed =
          plugin.manifest
            .capabilities
            ?.consumes ??
          [];

        expect(
          provided.some(
            (
              capability,
            ): boolean =>
              capability.id ===
              TerrainToken.id,
          ),
        ).toBe(
          true,
        );

        expect(
          consumed.some(
            (
              capability,
            ): boolean =>
              capability.id ===
              RenderToken.id,
          ),
        ).toBe(
          true,
        );

        expect(
          plugin.manifest
            .dependsOn
            ?.some(
              (
                dependency,
              ): boolean =>
                dependency.id ===
                "game.loop",
            ),
        ).toBe(
          true,
        );

        expect(
          plugin.manifest
            .dependsOn
            ?.some(
              (
                dependency,
              ): boolean =>
                dependency.id ===
                "game.render",
            ),
        ).toBe(
          true,
        );
      },
    );
  },
);