import {
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  EntityManager,
} from "../src/engine/world/EntityManager";

import {
  SpatialGrid,
} from "../src/engine/world/SpatialGrid";

import {
  OctreeManager,
} from "../src/engine/world/OctreeManager";

import {
  WorldStateSerializer,
} from "../src/engine/world/WorldStateSerializer";

import type {
  EntityComponentState,
} from "../src/contracts/world/types";

describe(
  "Camada de Mundo - Cenas, ECS & Particionamento Espacial (game.world)",
  (): void => {
    let entityManager:
      EntityManager;

    let spatialGrid:
      SpatialGrid;

    let octreeManager:
      OctreeManager;

    beforeEach(
      (): void => {
        entityManager =
          new EntityManager();

        spatialGrid =
          new SpatialGrid(
            16,
          );

        octreeManager =
          new OctreeManager();
      },
    );

    it(
      "deve realizar Spawn, consulta e Despawn de entidades no ECS Manager sem vazamento",
      (): void => {
        const entityState:
          EntityComponentState = {
            entityId:
              "player_1",

            type:
              "character",

            position: {
              x: 10,
              y: 0,
              z: 10,
            },

            rotation: {
              x: 0,
              y: 0,
              z: 0,
              w: 1,
            },

            scale: {
              x: 1,
              y: 1,
              z: 1,
            },

            tags: [
              "player",
              "hero",
            ],

            customData: {
              hp: 100,
            },
          };

        const spawned =
          entityManager
            .spawnEntity(
              entityState,
            );

        expect(
          spawned,
        ).toBe(
          true,
        );

        expect(
          entityManager
            .activeEntityCount,
        ).toBe(
          1,
        );

        const retrieved =
          entityManager
            .getEntityState(
              "player_1",
            );

        expect(
          retrieved,
        ).not.toBeNull();

        expect(
          retrieved
            ?.customData.hp,
        ).toBe(
          100,
        );

        const despawned =
          entityManager
            .despawnEntity(
              "player_1",
            );

        expect(
          despawned,
        ).toBe(
          true,
        );

        expect(
          entityManager
            .activeEntityCount,
        ).toBe(
          0,
        );
      },
    );

    it(
      "deve filtrar entidades por raio em um SpatialGrid 2D/2.5D",
      (): void => {
        spatialGrid.insert(
          "enemy_A",
          {
            x: 5,
            y: 0,
            z: 5,
          },
        );

        spatialGrid.insert(
          "enemy_B",
          {
            x: 50,
            y: 0,
            z: 50,
          },
        );

        const results =
          spatialGrid
            .queryRadius(
              {
                x: 0,
                z: 0,
              },
              15,
            );

        expect(
          results,
        ).toHaveLength(
          1,
        );

        expect(
          results[0],
        ).toBeDefined();

        expect(
          results[0]?.entityId,
        ).toBe(
          "enemy_A",
        );

        expect(
          results[0]?.position,
        ).toEqual({
          x: 5,
          y: 0,
          z: 5,
        });

        expect(
          results[0]?.distance,
        ).toBeCloseTo(
          Math.sqrt(
            50,
          ),
        );
      },
    );

    it(
      "deve excluir entidades fora do raio exato da consulta espacial",
      (): void => {
        spatialGrid.insert(
          "inside",
          {
            x: 3,
            y: 10,
            z: 4,
          },
        );

        spatialGrid.insert(
          "boundary",
          {
            x: 0,
            y: -20,
            z: 5,
          },
        );

        spatialGrid.insert(
          "outside",
          {
            x: 6,
            y: 0,
            z: 0,
          },
        );

        const results =
          spatialGrid
            .queryRadius(
              {
                x: 0,
                z: 0,
              },
              5,
            );

        const entityIds =
          results.map(
            (
              result,
            ) =>
              result.entityId,
          );

        expect(
          entityIds,
        ).toContain(
          "inside",
        );

        expect(
          entityIds,
        ).toContain(
          "boundary",
        );

        expect(
          entityIds,
        ).not.toContain(
          "outside",
        );

        expect(
          results,
        ).toHaveLength(
          2,
        );
      },
    );

    it(
      "deve atualizar uma entidade sem duplicá-la quando ela muda de célula espacial",
      (): void => {
        spatialGrid.insert(
          "moving_enemy",
          {
            x: 2,
            y: 0,
            z: 2,
          },
        );

        let results =
          spatialGrid
            .queryRadius(
              {
                x: 0,
                z: 0,
              },
              10,
            );

        expect(
          results,
        ).toHaveLength(
          1,
        );

        spatialGrid.insert(
          "moving_enemy",
          {
            x: 40,
            y: 0,
            z: 40,
          },
        );

        results =
          spatialGrid
            .queryRadius(
              {
                x: 0,
                z: 0,
              },
              10,
            );

        expect(
          results,
        ).toHaveLength(
          0,
        );

        const movedResults =
          spatialGrid
            .queryRadius(
              {
                x: 40,
                z: 40,
              },
              5,
            );

        expect(
          movedResults,
        ).toHaveLength(
          1,
        );

        expect(
          movedResults[0]
            ?.entityId,
        ).toBe(
          "moving_enemy",
        );

        expect(
          spatialGrid
            .entityCount,
        ).toBe(
          1,
        );
      },
    );

    it(
      "deve remover uma entidade do índice espacial",
      (): void => {
        spatialGrid.insert(
          "enemy_remove",
          {
            x: 4,
            y: 0,
            z: 4,
          },
        );

        expect(
          spatialGrid.remove(
            "enemy_remove",
          ),
        ).toBe(
          true,
        );

        expect(
          spatialGrid.remove(
            "enemy_remove",
          ),
        ).toBe(
          false,
        );

        const results =
          spatialGrid
            .queryRadius(
              {
                x: 0,
                z: 0,
              },
              20,
            );

        expect(
          results,
        ).toHaveLength(
          0,
        );

        expect(
          spatialGrid
            .entityCount,
        ).toBe(
          0,
        );
      },
    );

    it(
      "deve subdividir a Octree 3D e consultar entidades dentro do volume AABB",
      (): void => {
        for (
          let index = 0;
          index < 10;
          index += 1
        ) {
          octreeManager.insert(
            `node_${index}`,
            {
              x:
                index * 2,

              y:
                index * 2,

              z:
                index * 2,
            },
          );
        }

        expect(
          octreeManager
            .getNodeCount(),
        ).toBeGreaterThan(
          1,
        );

        const queried =
          octreeManager
            .queryBounds({
              min: {
                x: 0,
                y: 0,
                z: 0,
              },

              max: {
                x: 5,
                y: 5,
                z: 5,
              },
            });

        expect(
          queried.length,
        ).toBeGreaterThan(
          0,
        );

        expect(
          queried.some(
            (
              result,
            ) =>
              result.entityId ===
              "node_0",
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "deve serializar e desserializar o estado de mundo mantendo a integridade das entidades",
      (): void => {
        entityManager
          .spawnEntity({
            entityId:
              "npc_1",

            type:
              "villager",

            position: {
              x: 1,
              y: 2,
              z: 3,
            },

            rotation: {
              x: 0,
              y: 0,
              z: 0,
              w: 1,
            },

            scale: {
              x: 1,
              y: 1,
              z: 1,
            },

            tags: [
              "npc",
            ],

            customData: {
              quest:
                "main_01",
            },
          });

        const serialized =
          WorldStateSerializer
            .serialize(
              "Level_01",
              entityManager,
            );

        expect(
          typeof serialized,
        ).toBe(
          "string",
        );

        entityManager.clear();

        expect(
          entityManager
            .activeEntityCount,
        ).toBe(
          0,
        );

        const restored =
          WorldStateSerializer
            .deserialize(
              serialized,
              entityManager,
            );

        expect(
          restored,
        ).toBe(
          true,
        );

        expect(
          entityManager
            .activeEntityCount,
        ).toBe(
          1,
        );

        const restoredEntity =
          entityManager
            .getEntityState(
              "npc_1",
            );

        expect(
          restoredEntity,
        ).not.toBeNull();

        expect(
          restoredEntity
            ?.customData.quest,
        ).toBe(
          "main_01",
        );

        expect(
          restoredEntity
            ?.position,
        ).toEqual({
          x: 1,
          y: 2,
          z: 3,
        });
      },
    );
  },
);