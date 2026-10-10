import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  PhysicsApi,
} from "../../tokens/physics";

import type {
  PhysicsSandboxViewPort,
} from "./ports/PhysicsSandboxViewPort";

import type {
  PhysicsSandboxAudioPort,
} from "./ports/PhysicsSandboxAudioPort";

import {
  PhysicsSandboxGame,
} from "./PhysicsSandboxGame";

import {
  createProjectPlugins,
} from "../../project";

function createFixtures(): {
  physics:
    PhysicsApi;

  view:
    PhysicsSandboxViewPort;

  audio:
    PhysicsSandboxAudioPort;

  createdBodies:
    string[];

  removedBodies:
    string[];
} {
  const createdBodies:
    string[] =
      [];

  const removedBodies:
    string[] =
      [];

  const physics:
    PhysicsApi = {
      step():
        void {},

      createBody(
        id,
      ): boolean {
        createdBodies.push(
          id,
        );

        return true;
      },

      removeBody(
        id,
      ): boolean {
        removedBodies.push(
          id,
        );

        return true;
      },

      applyImpulse:
        vi.fn(
          () =>
            true,
        ),

      applyForce:
        vi.fn(
          () =>
            true,
        ),

      castRay:
        vi.fn(
          () => ({
            hit:
              false,

            distance:
              0,

            point: {
              x: 0,
              y: 0,
              z: 0,
            },

            normal: {
              x: 0,
              y: 0,
              z: 0,
            },
          }),
        ),

      getBodyTransform:
        vi.fn(
          () => ({
            position: {
              x: 0,
              y: 2,
              z: 0,
            },

            rotation: {
              x: 0,
              y: 0,
              z: 0,
              w: 1,
            },
          }),
        ),

      syncMeshTransform:
        vi.fn(
          () =>
            true,
        ),

      setGravity:
        vi.fn(),

      getStats:
        vi.fn(
          () => ({
            rigidBodyCount:
              2,

            colliderCount:
              2,

            stepTimeMs:
              0,

            isWasmLoaded:
              true,
          }),
        ),
    };

  const view:
    PhysicsSandboxViewPort = {
      setCubeTransform:
        vi.fn(),

      dispose:
        vi.fn(),
    };

  const audio:
    PhysicsSandboxAudioPort = {
      initialize:
        vi.fn(
          async () =>
            undefined,
        ),

      playJump:
        vi.fn(),

      playImpact:
        vi.fn(),

      dispose:
        vi.fn(),
    };

  return {
    physics,
    view,
    audio,
    createdBodies,
    removedBodies,
  };
}

describe(
  "PhysicsSandbox — isolamento por ports",
  () => {
    it(
      "o composition root cria somente o plugin consumidor",
      () => {
        // Explícito: com mais de um jogo em src/projects, a seleção exige o id.
        const plugins =
          createProjectPlugins(
            "physics-sandbox",
          );

        expect(
          plugins,
        ).toHaveLength(
          1,
        );

        expect(
          plugins[0]
            ?.manifest
            .id,
        ).toBe(
          "example.physics-sandbox",
        );

        expect(
          createProjectPlugins(
            "none",
          ),
        ).toEqual(
          [],
        );
      },
    );

    it(
      "cria, sincroniza e libera recursos via portas públicas",
      () => {
        const {
          physics,
          view,
          audio,
          createdBodies,
          removedBodies,
        } =
          createFixtures();

        const game =
          new PhysicsSandboxGame(
            physics,
            view,
            audio,
          );

        expect(
          createdBodies,
        ).toEqual([
          "example.physics-sandbox.floor",
          "example.physics-sandbox.cube",
        ]);

        game.syncVisual();

        expect(
          view
            .setCubeTransform,
        ).toHaveBeenCalled();

        expect(
          game.jump(),
        ).toBe(
          true,
        );

        expect(
          physics
            .applyImpulse,
        ).toHaveBeenCalledWith(
          "example.physics-sandbox.cube",
          {
            x: 0,
            y: 32,
            z: 0,
          },
        );

        expect(
          audio.playJump,
        ).toHaveBeenCalledTimes(
          1,
        );

        game.handleCollisionEnter(
          "example.physics-sandbox.cube",
          "example.physics-sandbox.floor",
        );

        expect(
          audio.playImpact,
        ).toHaveBeenCalledTimes(
          1,
        );

        game.handleCollisionEnter(
          "other.entity",
          "example.physics-sandbox.floor",
        );

        expect(
          audio.playImpact,
        ).toHaveBeenCalledTimes(
          1,
        );

        game.dispose();
        game.dispose();

        expect(
          removedBodies,
        ).toEqual([
          "example.physics-sandbox.cube",
          "example.physics-sandbox.floor",
        ]);

        expect(
          view.dispose,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          audio.dispose,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          game.jump(),
        ).toBe(
          false,
        );
      },
    );
  },
);
