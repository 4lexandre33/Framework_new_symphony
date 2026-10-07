import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  PluginContext,
} from "@core";

import type {
  PhysicsApi,
} from "../src/tokens/physics";

import type {
  WorldApi,
} from "../src/tokens/world";

import {
  AIAgentManager,
} from "../src/engine/ai/internal/AIAgentManager";

import {
  AIService,
} from "../src/engine/ai/internal/AIService";

import {
  PerceptionSystem,
} from "../src/engine/ai/internal/PerceptionSystem";

import {
  SteeringBehaviors,
} from "../src/engine/ai/internal/SteeringBehaviors";

function createAIContext():
  PluginContext {
  return {
    events: {
      emit(): void {},
    },
  } as unknown as
    PluginContext;
}

describe(
  "Layer 1 Stage 81 — AI lifecycle/hot paths",
  (): void => {
    it(
      "AIService.clear libera referências de Physics e World",
      (): void => {
        const service =
          new AIService(
            createAIContext(),
          );

        service.bindDependencies(
          {} as PhysicsApi,
          {} as WorldApi,
        );

        const internals =
          service as unknown as {
            physics:
              PhysicsApi | null;
            world:
              WorldApi | null;
          };

        expect(
          internals.physics,
        ).not.toBeNull();

        expect(
          internals.world,
        ).not.toBeNull();

        service.clear();

        expect(
          internals.physics,
        ).toBeNull();

        expect(
          internals.world,
        ).toBeNull();
      },
    );

    it(
      "AIAgentManager.clear remove agentes e NavMesh para restart limpo",
      (): void => {
        const manager =
          new AIAgentManager();

        manager.navMesh.loadGraph({
          polygons: [
            {
              id: 1,
              vertices: [
                {
                  x: 0,
                  y: 0,
                  z: 0,
                },
                {
                  x: 4,
                  y: 0,
                  z: 0,
                },
                {
                  x: 0,
                  y: 0,
                  z: 4,
                },
              ],
              neighbors: [],
              center: {
                x: 1,
                y: 0,
                z: 1,
              },
            },
          ],
        });

        expect(
          manager.registerAgent({
            agentId:
              "agent-stage81",
            entityId:
              "entity-stage81",
          }),
        ).toBe(
          true,
        );

        expect(
          manager.getAgentPosition(
            "agent-stage81",
          ),
        ).not.toBeNull();

        manager.clear();

        expect(
          manager.getAgentPosition(
            "agent-stage81",
          ),
        ).toBeNull();

        expect(
          manager.navMesh.findPath({
            start: {
              x: 0,
              y: 0,
              z: 0,
            },
            target: {
              x: 1,
              y: 0,
              z: 1,
            },
          }).found,
        ).toBe(
          false,
        );
      },
    );

    it(
      "PerceptionSystem e SteeringBehaviors reutilizam scratch state",
      (): void => {
        const perception =
          new PerceptionSystem();

        const firstPerception =
          perception.checkPerception(
            {
              x: 0,
              y: 0,
              z: 0,
            },
            {
              x: 0,
              y: 0,
              z: 1,
            },
            {
              x: 0,
              y: 0,
              z: 2,
            },
            {
              visionDistance: 10,
              visionAngleDegrees: 90,
              checkLineOfSight: false,
            },
          );

        const secondPerception =
          perception.checkPerception(
            {
              x: 0,
              y: 0,
              z: 0,
            },
            {
              x: 0,
              y: 0,
              z: 1,
            },
            {
              x: 0,
              y: 0,
              z: 3,
            },
            {
              visionDistance: 10,
              visionAngleDegrees: 90,
              checkLineOfSight: false,
            },
          );

        expect(
          secondPerception,
        ).toBe(
          firstPerception,
        );

        const steering =
          new SteeringBehaviors();

        const firstForce =
          steering.seek(
            {
              x: 0,
              y: 0,
              z: 0,
            },
            {
              x: 0,
              y: 0,
              z: 0,
            },
            {
              x: 5,
              y: 0,
              z: 0,
            },
            4,
            2,
          );

        const secondForce =
          steering.seek(
            {
              x: 1,
              y: 0,
              z: 0,
            },
            {
              x: 0,
              y: 0,
              z: 0,
            },
            {
              x: 5,
              y: 0,
              z: 0,
            },
            4,
            2,
          );

        expect(
          secondForce,
        ).toBe(
          firstForce,
        );
      },
    );
  },
);
