// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createAgentId,
} from "../src/domain/entities";

import {
  AbilityAction,
  AbilityActionError,
  createAbilityActionId,
  createAbilityId,
  createAbilityTargetReferenceId,
} from "../src/domain/mechanics";

describe(
  "Etapa 44.3 — AbilityAction",
  () => {
    it(
      "executa lifecycle pending -> committed -> resolved",
      () => {
        const action =
          new AbilityAction({
            id:
              createAbilityActionId(
                "action.001",
              ),
            abilityId:
              createAbilityId(
                "ability.attack",
              ),
            sourceAgentId:
              createAgentId(
                "agent.player",
              ),
            target: {
              kind: "agent",
              agentId:
                createAgentId(
                  "agent.enemy",
                ),
            },
          });

        expect(
          action.status,
        ).toBe("pending");

        expect(
          action.isTerminal,
        ).toBe(false);

        action.commit();

        expect(
          action.status,
        ).toBe("committed");

        action.resolve();

        expect(
          action.status,
        ).toBe("resolved");

        expect(
          action.isTerminal,
        ).toBe(true);
      },
    );

    it(
      "permite cancelamento antes ou depois do commit",
      () => {
        const pending =
          new AbilityAction({
            id:
              createAbilityActionId(
                "action.pending",
              ),
            abilityId:
              createAbilityId(
                "ability.dash",
              ),
            sourceAgentId:
              createAgentId(
                "agent.a",
              ),
            target: {
              kind: "self",
            },
          });

        pending.cancel(
          "input-cancelled",
        );

        expect(
          pending.status,
        ).toBe("cancelled");

        expect(
          pending.cancelReason,
        ).toBe(
          "input-cancelled",
        );

        const committed =
          new AbilityAction({
            id:
              createAbilityActionId(
                "action.committed",
              ),
            abilityId:
              createAbilityId(
                "ability.cast",
              ),
            sourceAgentId:
              createAgentId(
                "agent.a",
              ),
            target: {
              kind: "self",
            },
          });

        committed.commit();

        committed.cancel(
          "interrupted",
        );

        expect(
          committed.status,
        ).toBe("cancelled");
      },
    );

    it(
      "impede transições inválidas",
      () => {
        const action =
          new AbilityAction({
            id:
              createAbilityActionId(
                "action.invalid",
              ),
            abilityId:
              createAbilityId(
                "ability.attack",
              ),
            sourceAgentId:
              createAgentId(
                "agent.a",
              ),
            target: {
              kind: "self",
            },
          });

        expect(() =>
          action.resolve(),
        ).toThrow(
          AbilityActionError,
        );

        action.commit();
        action.resolve();

        expect(() =>
          action.commit(),
        ).toThrow(
          AbilityActionError,
        );

        expect(() =>
          action.cancel(
            "too-late",
          ),
        ).toThrow(
          AbilityActionError,
        );
      },
    );

    it(
      "usa reference opaca para alvos espaciais sem coordenadas",
      () => {
        const action =
          new AbilityAction({
            id:
              createAbilityActionId(
                "action.area",
              ),
            abilityId:
              createAbilityId(
                "ability.area",
              ),
            sourceAgentId:
              createAgentId(
                "agent.caster",
              ),
            target: {
              kind:
                "reference",
              targetId:
                createAbilityTargetReferenceId(
                  "target.area.17",
                ),
            },
          });

        expect(
          action.target,
        ).toEqual({
          kind: "reference",
          targetId:
            "target.area.17",
        });

        const snapshot =
          action.toSnapshot();

        expect(
          Object.keys(
            snapshot.target,
          ),
        ).not.toEqual(
          expect.arrayContaining([
            "x",
            "y",
            "z",
            "position",
            "direction",
            "ray",
            "transform",
          ]),
        );
      },
    );

    it(
      "rejeita cancel reason inválido",
      () => {
        const action =
          new AbilityAction({
            id:
              createAbilityActionId(
                "action.reason",
              ),
            abilityId:
              createAbilityId(
                "ability.reason",
              ),
            sourceAgentId:
              createAgentId(
                "agent.a",
              ),
            target: {
              kind: "self",
            },
          });

        expect(() =>
          action.cancel(""),
        ).toThrow(
          AbilityActionError,
        );

        expect(() =>
          action.cancel(
            " invalid ",
          ),
        ).toThrow(
          AbilityActionError,
        );
      },
    );
  },
);
