import {
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  NavMeshQuery,
} from "../src/engine/ai/internal/NavMeshQuery";

import {
  ActionNode,
  BehaviorTree,
  ConditionNode,
  SelectorNode,
  SequenceNode,
} from "../src/engine/ai/internal/BehaviorTree";

import {
  PerceptionSystem,
} from "../src/engine/ai/internal/PerceptionSystem";

import {
  SteeringBehaviors,
} from "../src/engine/ai/internal/SteeringBehaviors";

import {
  AIAgentManager,
} from "../src/engine/ai/internal/AIAgentManager";

import {
  SetBlackboardValueCommand,
  type NavMeshGraph,
} from "../src/contracts/ai/types";

import {
  createAIPlugin,
} from "../src/plugins/ai/plugin";

import {
  AiToken,
} from "../src/tokens/ai";

function createConnectedGraph():
  NavMeshGraph {
  return {
    polygons: [
      {
        id:
          0,

        vertices: [
          {
            x: 0,
            y: 0,
            z: 0,
          },

          {
            x: 10,
            y: 0,
            z: 0,
          },

          {
            x: 10,
            y: 0,
            z: 10,
          },

          {
            x: 0,
            y: 0,
            z: 10,
          },
        ],

        neighbors: [
          1,
        ],

        center: {
          x: 5,
          y: 0,
          z: 5,
        },
      },

      {
        id:
          1,

        vertices: [
          {
            x: 10,
            y: 0,
            z: 0,
          },

          {
            x: 20,
            y: 0,
            z: 0,
          },

          {
            x: 20,
            y: 0,
            z: 10,
          },

          {
            x: 10,
            y: 0,
            z: 10,
          },
        ],

        neighbors: [
          0,
        ],

        center: {
          x: 15,
          y: 0,
          z: 5,
        },
      },
    ],
  };
}

describe(
  "Camada de Inteligência Artificial & NavMesh (game.ai)",
  (): void => {
    let navMeshQuery:
      NavMeshQuery;

    let perceptionSystem:
      PerceptionSystem;

    let steering:
      SteeringBehaviors;

    beforeEach(
      (): void => {
        navMeshQuery =
          new NavMeshQuery();

        perceptionSystem =
          new PerceptionSystem();

        steering =
          new SteeringBehaviors();
      },
    );

    it(
      "deve calcular caminho tridimensional entre dois pontos em polígonos conectados",
      (): void => {
        navMeshQuery
          .loadGraph(
            createConnectedGraph(),
          );

        const result =
          navMeshQuery
            .findPath({
              start: {
                x: 1,
                y: 0,
                z: 1,
              },

              target: {
                x: 19,
                y: 0,
                z: 5,
              },
            });

        expect(
          result.found,
        ).toBe(
          true,
        );

        /*
         * start + portal compartilhado + target.
         */
        expect(
          result.waypoints,
        ).toHaveLength(
          3,
        );

        expect(
          result.totalDistance,
        ).toBeGreaterThan(
          0,
        );
      },
    );

    it(
      "deve retornar falha quando os polígonos da NavMesh não estiverem conectados",
      (): void => {
        const graph =
          createConnectedGraph();

        navMeshQuery
          .loadGraph({
            polygons:
              graph.polygons.map(
                (
                  polygon,
                ) => ({
                  ...polygon,

                  neighbors:
                    [],
                }),
              ),
          });

        const result =
          navMeshQuery
            .findPath({
              start: {
                x: 1,
                y: 0,
                z: 1,
              },

              target: {
                x: 19,
                y: 0,
                z: 5,
              },
            });

        expect(
          result.found,
        ).toBe(
          false,
        );

        expect(
          result.waypoints,
        ).toHaveLength(
          0,
        );
      },
    );

    it(
      "deve avaliar a Behavior Tree e alterar o estado no Blackboard",
      (): void => {
        const tree =
          new BehaviorTree(
            new SelectorNode([
              new SequenceNode([
                new ConditionNode(
                  (
                    blackboard,
                  ): boolean =>
                    blackboard.get(
                      "isEnemyVisible",
                    ) ===
                    true,
                ),

                new ActionNode(
                  (
                    blackboard,
                  ) => {
                    blackboard.set(
                      "state",
                      "ATTACK",
                    );

                    return "SUCCESS";
                  },
                ),
              ]),

              new ActionNode(
                (
                  blackboard,
                ) => {
                  blackboard.set(
                    "state",
                    "PATROL",
                  );

                  return "SUCCESS";
                },
              ),
            ]),
          );

        tree.memory.set(
          "isEnemyVisible",
          false,
        );

        tree.tick(
          0.016,
        );

        expect(
          tree.memory.get(
            "state",
          ),
        ).toBe(
          "PATROL",
        );

        tree.memory.set(
          "isEnemyVisible",
          true,
        );

        tree.tick(
          0.016,
        );

        expect(
          tree.memory.get(
            "state",
          ),
        ).toBe(
          "ATTACK",
        );
      },
    );

    it(
      "deve detectar alvo no cone de visão pelo PerceptionSystem",
      (): void => {
        const result =
          perceptionSystem
            .checkPerception(
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
                z: 5,
              },

              {
                visionAngleDegrees:
                  90,

                visionDistance:
                  10,

                hearingRadius:
                  2,

                checkLineOfSight:
                  false,
              },
            );

        expect(
          result.targetSpotted,
        ).toBe(
          true,
        );

        expect(
          result.senseType,
        ).toBe(
          "vision",
        );
      },
    );

    it(
      "deve limitar a força de Arrive pelo maxForce",
      (): void => {
        const force =
          steering.arrive(
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
              x: 10,
              y: 0,
              z: 0,
            },

            5,
            2,
            2,
          );

        expect(
          force.x,
        ).toBeGreaterThan(
          0,
        );

        const magnitude =
          Math.sqrt(
            force.x *
              force.x +
            force.y *
              force.y +
            force.z *
              force.z,
          );

        expect(
          magnitude,
        ).toBeLessThanOrEqual(
          2,
        );
      },
    );

    it(
      "deve registrar um agente, calcular uma rota e avançar sua posição",
      (): void => {
        const manager =
          new AIAgentManager();

        manager.navMesh
          .loadGraph(
            createConnectedGraph(),
          );

        const registered =
          manager.registerAgent({
            agentId:
              "enemy_1",

            entityId:
              "enemy_entity",

            initialPosition: {
              x: 1,
              y: 0,
              z: 1,
            },

            maxSpeed:
              5,

            maxForce:
              10,

            stoppingDistance:
              0.25,
          });

        expect(
          registered,
        ).toBe(
          true,
        );

        const path =
          manager.setAgentTarget(
            "enemy_1",
            {
              x: 19,
              y: 0,
              z: 5,
            },
          );

        expect(
          path.found,
        ).toBe(
          true,
        );

        const before =
          manager.getAgentPosition(
            "enemy_1",
          );

        for (
          let index = 0;
          index < 30;
          index += 1
        ) {
          manager.update(
            1 / 60,
            null,
          );
        }

        const after =
          manager.getAgentPosition(
            "enemy_1",
          );

        expect(
          before,
        ).not.toBeNull();

        expect(
          after,
        ).not.toBeNull();

        expect(
          after?.x,
        ).toBeGreaterThan(
          before?.x ??
            0,
        );
      },
    );

    it(
      "deve manter o identificador do comando de Blackboard consistente",
      (): void => {
        expect(
          SetBlackboardValueCommand
            .type,
        ).toBe(
          "game.ai.set-blackboard",
        );
      },
    );

    it(
      "deve declarar AiToken e dependência explícita do game.loop no plugin",
      (): void => {
        const plugin =
          createAIPlugin();

        const provides =
          plugin.manifest
            .capabilities
            ?.provides ??
          [];

        expect(
          provides.some(
            (
              capability,
            ): boolean =>
              capability.id ===
              AiToken.id,
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
      },
    );
  },
);