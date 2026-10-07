// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  EntitySnapshot,
} from "../src/contracts/net/types";

import {
  StateReplicator,
} from "../src/engine/net/internal/StateReplicator";

function snapshot(
  entityId: string,
  sequence: number,
  x: number,
): EntitySnapshot {
  return {
    entityId,
    type: "actor",
    position: {
      x,
      y: 0,
      z: 0,
    },
    rotation: {
      x: 0,
      y: 0,
      z: 0,
      w: 1,
    },
    velocity: {
      x: 1,
      y: 0,
      z: 0,
    },
    sequence,
    timestamp:
      sequence * 16,
  };
}

describe(
  "Etapa 83 — StateReplicator",
  () => {
    it(
      "ignora snapshots stale e interpola apenas a sequência monotônica",
      () => {
        const replicator =
          new StateReplicator();

        replicator.registerEntity(
          "entity-a",
          snapshot(
            "entity-a",
            10,
            10,
          ),
        );

        replicator.pushEntitySnapshot(
          snapshot(
            "entity-a",
            9,
            999,
          ),
        );

        replicator.pushEntitySnapshot(
          snapshot(
            "entity-a",
            11,
            20,
          ),
        );

        const state =
          replicator.getInterpolatedState(
            "entity-a",
            0.5,
          );

        expect(state).not.toBeNull();
        expect(state?.position.x).toBe(15);
        expect(state?.sequence).toBe(11);
      },
    );

    it(
      "não deixa mutação externa alterar o histórico interno",
      () => {
        const replicator =
          new StateReplicator();

        const initial =
          snapshot(
            "entity-a",
            1,
            10,
          );

        replicator.registerEntity(
          "entity-a",
          initial,
        );

        initial.position.x =
          500;

        const stored =
          replicator.getInterpolatedState(
            "entity-a",
            1,
          );

        expect(
          stored?.position.x,
        ).toBe(10);
      },
    );

    it(
      "mantém scratch de interpolação separado por entidade",
      () => {
        const replicator =
          new StateReplicator();

        replicator.registerEntity(
          "entity-a",
          snapshot(
            "entity-a",
            1,
            0,
          ),
        );

        replicator.pushEntitySnapshot(
          snapshot(
            "entity-a",
            2,
            10,
          ),
        );

        replicator.registerEntity(
          "entity-b",
          snapshot(
            "entity-b",
            1,
            100,
          ),
        );

        replicator.pushEntitySnapshot(
          snapshot(
            "entity-b",
            2,
            200,
          ),
        );

        const a =
          replicator.getInterpolatedState(
            "entity-a",
            0.5,
          );

        const b =
          replicator.getInterpolatedState(
            "entity-b",
            0.5,
          );

        expect(a).not.toBe(b);
        expect(a?.entityId).toBe(
          "entity-a",
        );
        expect(a?.position.x).toBe(5);
        expect(b?.entityId).toBe(
          "entity-b",
        );
        expect(b?.position.x).toBe(150);
      },
    );

    it(
      "gera snapshot de mundo ordenado e independente do Map insertion order",
      () => {
        const replicator =
          new StateReplicator();

        replicator.registerEntity(
          "zeta",
          snapshot(
            "zeta",
            1,
            1,
          ),
        );

        replicator.registerEntity(
          "alpha",
          snapshot(
            "alpha",
            1,
            2,
          ),
        );

        const world =
          replicator.generateWorldSnapshot(
            8,
            120,
            "76561198000000001",
          );

        expect(
          world.entities.map(
            (entity) =>
              entity.entityId,
          ),
        ).toEqual([
          "alpha",
          "zeta",
        ]);

        expect(world.sequence).toBe(8);
        expect(world.tick).toBe(120);
      },
    );

    it(
      "descarta snapshot estruturalmente inválido e clear remove estado",
      () => {
        const replicator =
          new StateReplicator();

        replicator.pushEntitySnapshot({
          ...snapshot(
            "entity-a",
            1,
            0,
          ),
          position: {
            x: Number.NaN,
            y: 0,
            z: 0,
          },
        });

        expect(
          replicator.getInterpolatedState(
            "entity-a",
            1,
          ),
        ).toBeNull();

        replicator.registerEntity(
          "entity-a",
          snapshot(
            "entity-a",
            1,
            0,
          ),
        );

        replicator.clear();

        expect(
          replicator.getInterpolatedState(
            "entity-a",
            1,
          ),
        ).toBeNull();
      },
    );
  },
);
