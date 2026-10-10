import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  PluginContext,
} from "@core";

import type {
  EntityComponentState,
  SceneDescriptor,
} from "../src/contracts/world/types";

import {
  EntityManager,
} from "../src/engine/world/internal/EntityManager";

import {
  OctreeManager,
} from "../src/engine/world/internal/OctreeManager";

import {
  SceneManager,
} from "../src/engine/world/internal/SceneManager";

import {
  SpatialGrid,
} from "../src/engine/world/internal/SpatialGrid";

import {
  WorldService,
} from "../src/engine/world/internal/WorldService";

function createEntity(
  entityId: string,
  x = 0,
  y = 0,
  z = 0,
): EntityComponentState {
  return {
    entityId,
    type:
      "test-entity",
    position: {
      x,
      y,
      z,
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
      "stage81",
    ],
    customData: {
      owner:
        entityId,
    },
  };
}

function createWorldContext():
  PluginContext {
  return {
    events: {
      emit(): void {},
    },
  } as unknown as
    PluginContext;
}

describe(
  "Layer 1 Stage 81 — World lifetime/spatial",
  (): void => {
    it(
      "não reutiliza um snapshot despawnado como outra entidade",
      (): void => {
        const manager =
          new EntityManager();

        manager.spawnEntity(
          createEntity(
            "entity-a",
          ),
        );

        const heldReference =
          manager.getEntityState(
            "entity-a",
          );

        expect(
          heldReference,
        ).not.toBeNull();

        expect(
          manager.despawnEntity(
            "entity-a",
          ),
        ).toBe(
          true,
        );

        manager.spawnEntity(
          createEntity(
            "entity-b",
            10,
          ),
        );

        const second =
          manager.getEntityState(
            "entity-b",
          );

        expect(
          second,
        ).not.toBeNull();

        expect(
          second,
        ).not.toBe(
          heldReference,
        );

        expect(
          heldReference?.entityId,
        ).toBe(
          "entity-a",
        );
      },
    );

    it(
      "Octree atualiza movimento por entityId sem duplicata e remove no despawn",
      (): void => {
        const octree =
          new OctreeManager();

        octree.insert(
          "moving",
          {
            x: 0,
            y: 0,
            z: 0,
          },
        );

        expect(
          octree.entityCount,
        ).toBe(
          1,
        );

        expect(
          octree.update(
            "moving",
            {
              x: 100,
              y: 2,
              z: 100,
            },
          ),
        ).toBe(
          true,
        );

        expect(
          octree.queryBounds({
            min: {
              x: -5,
              y: -5,
              z: -5,
            },
            max: {
              x: 5,
              y: 5,
              z: 5,
            },
          }),
        ).toHaveLength(
          0,
        );

        const moved =
          octree.queryBounds({
            min: {
              x: 95,
              y: -5,
              z: 95,
            },
            max: {
              x: 105,
              y: 5,
              z: 105,
            },
          });

        expect(
          moved,
        ).toHaveLength(
          1,
        );

        expect(
          moved[0]?.entityId,
        ).toBe(
          "moving",
        );

        expect(
          octree.entityCount,
        ).toBe(
          1,
        );

        expect(
          octree.remove(
            "moving",
          ),
        ).toBe(
          true,
        );

        expect(
          octree.queryBounds({
            min: {
              x: 90,
              y: -10,
              z: 90,
            },
            max: {
              x: 110,
              y: 10,
              z: 110,
            },
          }),
        ).toHaveLength(
          0,
        );
      },
    );

    it(
      "WorldService sincroniza SpatialGrid e Octree após updateEntityTransform",
      (): void => {
        const world =
          new WorldService(
            createWorldContext(),
          );

        world.spawnEntity(
          createEntity(
            "walker",
            1,
            0,
            1,
          ),
        );

        const state =
          world.getEntityState(
            "walker",
          );

        expect(
          state,
        ).not.toBeNull();

        // Snapshots são imutáveis (G31): a mudança técnica de posição
        // passa pela API e os índices ficam consistentes após o tick.
        expect(
          Object.isFrozen(
            state?.position,
          ),
        ).toBe(
          true,
        );

        expect(
          world.updateEntityTransform(
            "walker",
            {
              position: {
                x: 64,
                y: 0,
                z: 64,
              },
            },
          ),
        ).toBe(
          true,
        );

        world.tick();

        expect(
          world.querySpatialGrid(
            {
              x: 1,
              z: 1,
            },
            4,
          ),
        ).toHaveLength(
          0,
        );

        expect(
          world.queryOctree({
            min: {
              x: -2,
              y: -2,
              z: -2,
            },
            max: {
              x: 4,
              y: 2,
              z: 4,
            },
          }),
        ).toHaveLength(
          0,
        );

        expect(
          world.querySpatialGrid(
            {
              x: 64,
              z: 64,
            },
            2,
          )[0]?.entityId,
        ).toBe(
          "walker",
        );

        expect(
          world.queryOctree({
            min: {
              x: 63,
              y: -1,
              z: 63,
            },
            max: {
              x: 65,
              y: 1,
              z: 65,
            },
          })[0]?.entityId,
        ).toBe(
          "walker",
        );
      },
    );

    it(
      "SceneManager sempre libera a trava de loading após falha e permite nova tentativa",
      async (): Promise<void> => {
        let rejectNextEmit =
          true;

        const context = {
          events: {
            emit(): void {
              if (rejectNextEmit) {
                rejectNextEmit =
                  false;

                throw new Error(
                  "stage81-scene-event-failure",
                );
              }
            },
          },
        } as unknown as
          PluginContext;

        const manager =
          new SceneManager(
            context,
            new EntityManager(),
            new SpatialGrid(),
            new OctreeManager(),
          );

        const scene:
          SceneDescriptor = {
            sceneId:
              "stage81-scene",
            sceneName:
              "Stage 81",
            assetsToPreload:
              [],
          };

        await expect(
          manager.loadScene(
            scene,
          ),
        ).rejects.toThrow(
          "stage81-scene-event-failure",
        );

        await expect(
          manager.loadScene(
            scene,
          ),
        ).resolves.toBe(
          true,
        );

        expect(
          manager.currentSceneId,
        ).toBe(
          "stage81-scene",
        );

        manager.clear();

        expect(
          manager.currentSceneId,
        ).toBeNull();
      },
    );
  },
);
