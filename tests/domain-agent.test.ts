// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  Agent,
  AgentInvariantError,
  createAgentId,
} from "../src/domain/entities";

describe(
  "Etapa 44.1 — Agent",
  () => {
    it(
      "cria Agent com defaults consistentes",
      () => {
        const agent =
          new Agent({
            id: createAgentId(
              "agent.player",
            ),
            displayName:
              "Player",
            maxHealth: 100,
          });

        expect(agent.health).toBe(
          100,
        );
        expect(agent.maxHealth).toBe(
          100,
        );
        expect(agent.level).toBe(1);
        expect(
          agent.experience,
        ).toBe(0);
        expect(agent.alive).toBe(
          true,
        );
      },
    );

    it(
      "aplica dano e cura in-place sem ultrapassar invariantes",
      () => {
        const agent =
          new Agent({
            id: createAgentId(
              "agent.guard",
            ),
            displayName: "Guard",
            maxHealth: 80,
          });

        expect(
          agent.applyDamage(30),
        ).toBe(30);
        expect(agent.health).toBe(
          50,
        );

        expect(
          agent.heal(10),
        ).toBe(10);
        expect(agent.health).toBe(
          60,
        );

        expect(
          agent.heal(1000),
        ).toBe(20);
        expect(agent.health).toBe(
          80,
        );
      },
    );

    it(
      "não revive implicitamente através de heal",
      () => {
        const agent =
          new Agent({
            id: createAgentId(
              "agent.dead",
            ),
            displayName: "Dead",
            maxHealth: 10,
          });

        agent.kill();

        expect(agent.alive).toBe(
          false,
        );
        expect(agent.heal(5)).toBe(
          0,
        );
        expect(agent.health).toBe(
          0,
        );

        agent.revive(4);

        expect(agent.alive).toBe(
          true,
        );
        expect(agent.health).toBe(
          4,
        );
      },
    );

    it(
      "mantém level e XP sem impor curva de progressão",
      () => {
        const agent =
          new Agent({
            id: createAgentId(
              "agent.progress",
            ),
            displayName:
              "Progress",
            maxHealth: 50,
          });

        expect(
          agent.addExperience(25),
        ).toBe(25);

        agent.setLevel(3);

        expect(agent.level).toBe(
          3,
        );
        expect(
          agent.experience,
        ).toBe(25);
      },
    );

    it(
      "gera snapshot somente com estado de gameplay dimension-agnostic",
      () => {
        const agent =
          new Agent({
            id: createAgentId(
              "agent.snapshot",
            ),
            displayName:
              "Snapshot",
            maxHealth: 30,
            health: 15,
            level: 2,
            experience: 9,
          });

        const snapshot =
          agent.toSnapshot();

        expect(snapshot).toEqual({
          id: "agent.snapshot",
          displayName:
            "Snapshot",
          health: 15,
          maxHealth: 30,
          level: 2,
          experience: 9,
          alive: true,
        });

        expect(
          Object.keys(snapshot),
        ).not.toEqual(
          expect.arrayContaining([
            "x",
            "y",
            "z",
            "position",
            "rotation",
            "transform",
            "sprite",
            "mesh",
            "collider",
          ]),
        );
      },
    );

    it(
      "rejeita estados inválidos",
      () => {
        const id =
          createAgentId(
            "agent.invalid",
          );

        expect(() =>
          new Agent({
            id,
            displayName: "",
            maxHealth: 10,
          }),
        ).toThrow(
          AgentInvariantError,
        );

        expect(() =>
          new Agent({
            id,
            displayName: "Valid",
            maxHealth: 10,
            health: 11,
          }),
        ).toThrow(
          AgentInvariantError,
        );

        expect(() =>
          new Agent({
            id,
            displayName: "Valid",
            maxHealth: 0,
          }),
        ).toThrow(
          AgentInvariantError,
        );
      },
    );
  },
);
