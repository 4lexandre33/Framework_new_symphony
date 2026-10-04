// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  Affordance,
  AffordanceError,
  createInteractionActorId,
  createInteractionActorRef,
  createInteractionActorTypeId,
  createInteractionId,
  createInteractionIntent,
  createInteractionRequirement,
  createInteractionRequirementId,
  createInteractionRequirementResolution,
  createInteractionTargetId,
  createInteractionTargetRef,
  createInteractionTargetTypeId,
  InteractionOutcomeError,
  resolveInteractionOutcome,
} from "../src/domain/interaction";

function actorRef() {
  return createInteractionActorRef(
    createInteractionActorTypeId(
      "actor.agent",
    ),
    createInteractionActorId(
      "agent.player",
    ),
  );
}

function targetRef(
  id = "world-object.door",
) {
  return createInteractionTargetRef(
    createInteractionTargetTypeId(
      "target.world-object",
    ),
    createInteractionTargetId(
      id,
    ),
  );
}

describe(
  "Etapa 54 — InteractionIntent",
  () => {
    it(
      "cria intent puramente semântico",
      () => {
        const intent =
          createInteractionIntent(
            createInteractionId(
              "interaction.open",
            ),
            actorRef(),
            targetRef(),
          );

        expect(intent).toEqual({
          interactionId:
            "interaction.open",
          actor: {
            typeId:
              "actor.agent",
            actorId:
              "agent.player",
          },
          target: {
            typeId:
              "target.world-object",
            targetId:
              "world-object.door",
          },
        });

        expect(
          Object.isFrozen(
            intent,
          ),
        ).toBe(true);
      },
    );
  },
);

describe(
  "Etapa 54 — Affordance",
  () => {
    it(
      "declara interação/target/requisitos em ordem determinística",
      () => {
        const requirementB =
          createInteractionRequirement(
            createInteractionRequirementId(
              "requirement.zeta",
            ),
          );

        const requirementA =
          createInteractionRequirement(
            createInteractionRequirementId(
              "requirement.alpha",
            ),
          );

        const affordance =
          new Affordance({
            interactionId:
              createInteractionId(
                "interaction.open",
              ),
            target:
              targetRef(),
            requirements: [
              requirementB,
              requirementA,
            ],
          });

        expect(
          affordance
            .getRequirements()
            .map(
              (requirement) =>
                requirement.id,
            ),
        ).toEqual([
          "requirement.alpha",
          "requirement.zeta",
        ]);

        expect(
          affordance
            .toSnapshot()
            .requirementIds,
        ).toEqual([
          "requirement.alpha",
          "requirement.zeta",
        ]);
      },
    );

    it(
      "rejeita requirement duplicado",
      () => {
        const requirement =
          createInteractionRequirement(
            createInteractionRequirementId(
              "requirement.key",
            ),
          );

        expect(() =>
          new Affordance({
            interactionId:
              createInteractionId(
                "interaction.open",
              ),
            target:
              targetRef(),
            requirements: [
              requirement,
              requirement,
            ],
          }),
        ).toThrow(
          AffordanceError,
        );
      },
    );

    it(
      "supports exige InteractionId e target compatíveis",
      () => {
        const affordance =
          new Affordance({
            interactionId:
              createInteractionId(
                "interaction.open",
              ),
            target:
              targetRef(),
          });

        expect(
          affordance.supports(
            createInteractionIntent(
              createInteractionId(
                "interaction.open",
              ),
              actorRef(),
              targetRef(),
            ),
          ),
        ).toBe(true);

        expect(
          affordance.supports(
            createInteractionIntent(
              createInteractionId(
                "interaction.close",
              ),
              actorRef(),
              targetRef(),
            ),
          ),
        ).toBe(false);

        expect(
          affordance.supports(
            createInteractionIntent(
              createInteractionId(
                "interaction.open",
              ),
              actorRef(),
              targetRef(
                "world-object.other",
              ),
            ),
          ),
        ).toBe(false);
      },
    );
  },
);

describe(
  "Etapa 54 — InteractionOutcome",
  () => {
    it(
      "aceita affordance sem requisitos",
      () => {
        const intent =
          createInteractionIntent(
            createInteractionId(
              "interaction.inspect",
            ),
            actorRef(),
            targetRef(),
          );

        const affordance =
          new Affordance({
            interactionId:
              intent.interactionId,
            target:
              intent.target,
          });

        expect(
          resolveInteractionOutcome(
            intent,
            affordance,
          ),
        ).toEqual({
          accepted: true,
          intent,
        });
      },
    );

    it(
      "rejeita interação/target não suportados",
      () => {
        const intent =
          createInteractionIntent(
            createInteractionId(
              "interaction.open",
            ),
            actorRef(),
            targetRef(),
          );

        const affordance =
          new Affordance({
            interactionId:
              createInteractionId(
                "interaction.talk",
              ),
            target:
              targetRef(),
          });

        expect(
          resolveInteractionOutcome(
            intent,
            affordance,
          ),
        ).toEqual({
          accepted: false,
          intent,
          reason:
            "unsupported-interaction",
          requirementIds: [],
        });
      },
    );

    it(
      "distingue requirement ausente de requirement insatisfeito",
      () => {
        const key =
          createInteractionRequirementId(
            "requirement.has-key",
          );

        const quest =
          createInteractionRequirementId(
            "requirement.quest-allows",
          );

        const intent =
          createInteractionIntent(
            createInteractionId(
              "interaction.open",
            ),
            actorRef(),
            targetRef(),
          );

        const affordance =
          new Affordance({
            interactionId:
              intent.interactionId,
            target:
              intent.target,
            requirements: [
              createInteractionRequirement(
                key,
              ),
              createInteractionRequirement(
                quest,
              ),
            ],
          });

        expect(
          resolveInteractionOutcome(
            intent,
            affordance,
            [
              createInteractionRequirementResolution(
                key,
                true,
              ),
            ],
          ),
        ).toEqual({
          accepted: false,
          intent,
          reason:
            "requirements-unresolved",
          requirementIds: [
            quest,
          ],
        });

        expect(
          resolveInteractionOutcome(
            intent,
            affordance,
            [
              createInteractionRequirementResolution(
                key,
                true,
              ),
              createInteractionRequirementResolution(
                quest,
                false,
              ),
            ],
          ),
        ).toEqual({
          accepted: false,
          intent,
          reason:
            "requirements-unsatisfied",
          requirementIds: [
            quest,
          ],
        });
      },
    );

    it(
      "aceita quando todos requirements estão satisfeitos",
      () => {
        const a =
          createInteractionRequirementId(
            "requirement.a",
          );

        const b =
          createInteractionRequirementId(
            "requirement.b",
          );

        const intent =
          createInteractionIntent(
            createInteractionId(
              "interaction.use",
            ),
            actorRef(),
            targetRef(),
          );

        const affordance =
          new Affordance({
            interactionId:
              intent.interactionId,
            target:
              intent.target,
            requirements: [
              createInteractionRequirement(
                a,
              ),
              createInteractionRequirement(
                b,
              ),
            ],
          });

        expect(
          resolveInteractionOutcome(
            intent,
            affordance,
            [
              createInteractionRequirementResolution(
                b,
                true,
              ),
              createInteractionRequirementResolution(
                a,
                true,
              ),
            ],
          ),
        ).toEqual({
          accepted: true,
          intent,
        });
      },
    );

    it(
      "rejeita resolutions duplicadas/desconhecidas como erro estrutural",
      () => {
        const required =
          createInteractionRequirementId(
            "requirement.required",
          );

        const unknown =
          createInteractionRequirementId(
            "requirement.unknown",
          );

        const intent =
          createInteractionIntent(
            createInteractionId(
              "interaction.use",
            ),
            actorRef(),
            targetRef(),
          );

        const affordance =
          new Affordance({
            interactionId:
              intent.interactionId,
            target:
              intent.target,
            requirements: [
              createInteractionRequirement(
                required,
              ),
            ],
          });

        expect(() =>
          resolveInteractionOutcome(
            intent,
            affordance,
            [
              createInteractionRequirementResolution(
                required,
                true,
              ),
              createInteractionRequirementResolution(
                required,
                true,
              ),
            ],
          ),
        ).toThrow(
          InteractionOutcomeError,
        );

        expect(() =>
          resolveInteractionOutcome(
            intent,
            affordance,
            [
              createInteractionRequirementResolution(
                unknown,
                true,
              ),
            ],
          ),
        ).toThrow(
          InteractionOutcomeError,
        );
      },
    );

    it(
      "aceitação não executa side effects",
      () => {
        const intent =
          createInteractionIntent(
            createInteractionId(
              "interaction.pickup",
            ),
            actorRef(),
            targetRef(
              "world-object.item",
            ),
          );

        const affordance =
          new Affordance({
            interactionId:
              intent.interactionId,
            target:
              intent.target,
          });

        const before =
          JSON.stringify(intent);

        const outcome =
          resolveInteractionOutcome(
            intent,
            affordance,
          );

        expect(
          outcome.accepted,
        ).toBe(true);

        expect(
          JSON.stringify(intent),
        ).toBe(before);
      },
    );
  },
);
