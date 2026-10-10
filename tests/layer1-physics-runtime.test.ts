// @vitest-environment node

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  PHYSICS_MAX_STEP_SECONDS,
  PHYSICS_MIN_STEP_SECONDS,
  PhysicsWorld,
} from "../src/engine/physics/internal/PhysicsWorld";

describe(
  "Etapa 77 — PhysicsWorld deterministic runtime",
  () => {
    let world:
      PhysicsWorld;

    beforeEach(
      async (): Promise<void> => {
        let now =
          100;

        world =
          new PhysicsWorld(
            (): number => {
              now +=
                0.25;

              return now;
            },
          );

        expect(
          await world.initialize(),
        ).toBe(true);
      },
    );

    afterEach(
      (): void => {
        world.dispose();
      },
    );

    it(
      "usa exatamente o fixed delta recebido do game loop",
      (): void => {
        world.createBody(
          "falling",
          {
            bodyType:
              "dynamic",
            position: {
              x:
                0,
              y:
                10,
              z:
                0,
            },
          },
          {
            shapeType:
              "box",
          },
        );

        for (
          let tick =
            0;
          tick <
          120;
          tick +=
            1
        ) {
          world.step(
            1 /
            60,
          );
        }

        const transform =
          world.getBodyTransform(
            "falling",
          );

        expect(transform)
          .not.toBeNull();

        expect(
          transform?.position.y,
        ).toBeLessThan(
          10,
        );

        expect(
          world.getStats()
            .stepTimeMs,
        ).toBeCloseTo(
          0.25,
        );
      },
    );

    it(
      "rejeita dt inválido em vez de clampar silenciosamente",
      (): void => {
        expect(
          (): void => {
            world.step(
              0,
            );
          },
        ).toThrow();

        expect(
          (): void => {
            world.step(
              Number.NaN,
            );
          },
        ).toThrow();

        expect(
          (): void => {
            world.step(
              PHYSICS_MIN_STEP_SECONDS /
                2,
            );
          },
        ).toThrow();

        expect(
          (): void => {
            world.step(
              PHYSICS_MAX_STEP_SECONDS +
                0.01,
            );
          },
        ).toThrow();
      },
    );

    it(
      "getBodyTransform devolve cópias independentes por leitura (G33)",
      (): void => {
        world.createBody(
          "a",
          {
            bodyType:
              "fixed",
            position: {
              x:
                1,
              y:
                2,
              z:
                3,
            },
          },
        );

        world.createBody(
          "b",
          {
            bodyType:
              "fixed",
            position: {
              x:
                4,
              y:
                5,
              z:
                6,
            },
          },
        );

        const firstA =
          world.getBodyTransform(
            "a",
          );

        const secondA =
          world.getBodyTransform(
            "a",
          );

        const b =
          world.getBodyTransform(
            "b",
          );

        expect(firstA)
          .not.toBe(secondA);

        expect(firstA)
          .toEqual(secondA);

        expect(firstA)
          .not.toBe(b);

        expect(
          firstA?.position,
        ).toEqual({
          x:
            1,
          y:
            2,
          z:
            3,
        });

        expect(
          b?.position,
        ).toEqual({
          x:
            4,
          y:
            5,
          z:
            6,
        });
      },
    );

    it(
      "preserva body anterior quando replacement possui collider inválido",
      (): void => {
        world.createBody(
          "stable",
          {
            bodyType:
              "fixed",
            position: {
              x:
                7,
              y:
                8,
              z:
                9,
            },
          },
          {
            shapeType:
              "box",
          },
        );

        expect(
          (): void => {
            world.createBody(
              "stable",
              {
                bodyType:
                  "dynamic",
              },
              {
                shapeType:
                  "sphere",
                radius:
                  0,
              },
            );
          },
        ).toThrow();

        expect(
          world.getBodyTransform(
            "stable",
          )?.position,
        ).toEqual({
          x:
            7,
          y:
            8,
          z:
            9,
        });

        expect(
          world.getStats()
            .rigidBodyCount,
        ).toBe(1);
      },
    );

    it(
      "substitui body duplicado e mantém stats coerentes",
      (): void => {
        expect(
          world.createBody(
            "entity",
            {
              bodyType:
                "fixed",
            },
            {
              shapeType:
                "sphere",
              radius:
                1,
            },
          ),
        ).toBe(true);

        expect(
          world.createBody(
            "entity",
            {
              bodyType:
                "fixed",
            },
            {
              shapeType:
                "box",
            },
          ),
        ).toBe(true);

        const stats =
          world.getStats();

        expect(
          stats.rigidBodyCount,
        ).toBe(1);

        expect(
          stats.colliderCount,
        ).toBe(1);

        expect(
          world.removeBody(
            "entity",
          ),
        ).toBe(true);

        expect(
          world.getStats()
            .rigidBodyCount,
        ).toBe(0);
      },
    );

    it(
      "dispose é idempotente e invalida reuso da instância",
      async (): Promise<void> => {
        const statsBefore =
          world.getStats();

        expect(
          statsBefore,
        ).toBe(
          world.getStats(),
        );

        world.dispose();
        world.dispose();

        expect(
          world.getStats(),
        ).toMatchObject({
          rigidBodyCount:
            0,
          colliderCount:
            0,
          stepTimeMs:
            0,
          isWasmLoaded:
            false,
        });

        expect(
          await world.initialize(),
        ).toBe(false);

        expect(
          world.createBody(
            "after-dispose",
            {
              bodyType:
                "fixed",
            },
          ),
        ).toBe(false);
      },
    );
  },
);
