// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createMovementEndpointId,
  createMovementIntent,
  createMovementModeId,
  createRequirementId,
  createRequirementRuleId,
  createTraversalCapabilityId,
  createTraversalRuleId,
  DamageRule,
  DamageRuleError,
  HealingRule,
  HealingRuleError,
  MovementRuleError,
  RequirementRule,
  RequirementRuleError,
  TraversalRule,
  TraversalRuleError,
} from "../src/domain/mechanics";

describe(
  "Etapa 59 — DamageRule",
  () => {
    it(
      "aplica mitigation antes do multiplier e satura pela vida atual",
      () => {
        const rule =
          new DamageRule();

        const outcome =
          rule.evaluate({
            currentHealth: 50,
            incomingDamage: 40,
            flatMitigation: 10,
            multiplier: 2,
          });

        expect(
          outcome.accepted,
        ).toBe(true);

        if (
          !outcome.accepted
        ) {
          throw new Error(
            "Damage deveria ter sido aceito.",
          );
        }

        expect(
          outcome.value,
        ).toEqual({
          previousHealth: 50,
          requestedDamage: 40,
          effectiveDamage: 60,
          appliedDamage: 50,
          overkillDamage: 10,
          nextHealth: 0,
          lethal: true,
        });
      },
    );

    it(
      "mitigation total produz dano zero sem rejeitar a regra",
      () => {
        const outcome =
          new DamageRule()
            .evaluate({
              currentHealth: 100,
              incomingDamage: 20,
              flatMitigation: 25,
            });

        expect(
          outcome.accepted,
        ).toBe(true);

        if (
          !outcome.accepted
        ) {
          throw new Error(
            "Damage deveria ter sido aceito.",
          );
        }

        expect(
          outcome.value
            .appliedDamage,
        ).toBe(0);

        expect(
          outcome.value.nextHealth,
        ).toBe(100);

        expect(
          outcome.value.lethal,
        ).toBe(false);
      },
    );

    it(
      "rejeita alvo já derrotado",
      () => {
        const outcome =
          new DamageRule()
            .evaluate({
              currentHealth: 0,
              incomingDamage: 10,
            });

        expect(outcome).toEqual({
          accepted: false,
          reason:
            "target-already-defeated",
          details: null,
        });
      },
    );

    it(
      "rejeita inputs inválidos estruturalmente",
      () => {
        const rule =
          new DamageRule();

        expect(() =>
          rule.evaluate({
            currentHealth: 10,
            incomingDamage: -1,
          }),
        ).toThrow(
          DamageRuleError,
        );

        expect(() =>
          rule.evaluate({
            currentHealth: 10,
            incomingDamage: 1,
            multiplier:
              Number.POSITIVE_INFINITY,
          }),
        ).toThrow(
          DamageRuleError,
        );
      },
    );
  },
);

describe(
  "Etapa 59 — HealingRule",
  () => {
    it(
      "satura cura no maxHealth e reporta excesso",
      () => {
        const outcome =
          new HealingRule()
            .evaluate({
              currentHealth: 75,
              maxHealth: 100,
              incomingHealing: 40,
            });

        expect(
          outcome.accepted,
        ).toBe(true);

        if (
          !outcome.accepted
        ) {
          throw new Error(
            "Healing deveria ter sido aceito.",
          );
        }

        expect(
          outcome.value,
        ).toEqual({
          previousHealth: 75,
          maxHealth: 100,
          requestedHealing: 40,
          effectiveHealing: 40,
          appliedHealing: 25,
          wastedHealing: 15,
          nextHealth: 100,
          fullyRestored: true,
        });
      },
    );

    it(
      "não transforma heal em revive",
      () => {
        const outcome =
          new HealingRule()
            .evaluate({
              currentHealth: 0,
              maxHealth: 100,
              incomingHealing: 50,
            });

        expect(outcome).toEqual({
          accepted: false,
          reason:
            "target-defeated",
          details: null,
        });
      },
    );

    it(
      "valida currentHealth <= maxHealth",
      () => {
        expect(() =>
          new HealingRule()
            .evaluate({
              currentHealth: 101,
              maxHealth: 100,
              incomingHealing: 1,
            }),
        ).toThrow(
          HealingRuleError,
        );
      },
    );
  },
);

describe(
  "Etapa 59 — Movement / Traversal",
  () => {
    const walk =
      createMovementModeId(
        "movement.walk",
      );

    const swim =
      createMovementModeId(
        "movement.swim",
      );

    const breatheWater =
      createTraversalCapabilityId(
        "capability.breathe-water",
      );

    it(
      "MovementIntent é puramente semântico e exige endpoints distintos",
      () => {
        const from =
          createMovementEndpointId(
            "endpoint.town",
          );

        const to =
          createMovementEndpointId(
            "endpoint.forest",
          );

        expect(
          createMovementIntent(
            from,
            to,
            walk,
          ),
        ).toEqual({
          from,
          to,
          modeId: walk,
        });

        expect(() =>
          createMovementIntent(
            from,
            from,
            walk,
          ),
        ).toThrow(
          MovementRuleError,
        );
      },
    );

    it(
      "TraversalRule aceita mode permitido com capabilities suficientes",
      () => {
        const rule =
          new TraversalRule({
            id:
              createTraversalRuleId(
                "traversal.river",
              ),
            allowedModeIds: [
              swim,
            ],
            requiredCapabilityIds: [
              breatheWater,
            ],
          });

        const intent =
          createMovementIntent(
            createMovementEndpointId(
              "endpoint.bank-a",
            ),
            createMovementEndpointId(
              "endpoint.bank-b",
            ),
            swim,
          );

        const outcome =
          rule.evaluate(
            intent,
            new Set([
              breatheWater,
            ]),
          );

        expect(
          outcome.accepted,
        ).toBe(true);

        if (
          !outcome.accepted
        ) {
          throw new Error(
            "Traversal deveria ter sido aceito.",
          );
        }

        expect(
          outcome.value.ruleId,
        ).toBe(
          "traversal.river",
        );

        expect(
          outcome.value.intent,
        ).toBe(intent);
      },
    );

    it(
      "TraversalRule rejeita mode não permitido",
      () => {
        const rule =
          new TraversalRule({
            id:
              createTraversalRuleId(
                "traversal.river",
              ),
            allowedModeIds: [
              swim,
            ],
          });

        const outcome =
          rule.evaluate(
            createMovementIntent(
              createMovementEndpointId(
                "endpoint.a",
              ),
              createMovementEndpointId(
                "endpoint.b",
              ),
              walk,
            ),
            new Set(),
          );

        expect(
          outcome.accepted,
        ).toBe(false);

        if (
          outcome.accepted
        ) {
          throw new Error(
            "Traversal deveria ter sido rejeitado.",
          );
        }

        expect(
          outcome.reason,
        ).toBe(
          "unsupported-movement-mode",
        );
      },
    );

    it(
      "TraversalRule informa primeira capability ausente em ordem canônica",
      () => {
        const alpha =
          createTraversalCapabilityId(
            "capability.alpha",
          );

        const zeta =
          createTraversalCapabilityId(
            "capability.zeta",
          );

        const rule =
          new TraversalRule({
            id:
              createTraversalRuleId(
                "traversal.locked",
              ),
            allowedModeIds: [
              walk,
            ],
            requiredCapabilityIds: [
              zeta,
              alpha,
            ],
          });

        const outcome =
          rule.evaluate(
            createMovementIntent(
              createMovementEndpointId(
                "endpoint.a",
              ),
              createMovementEndpointId(
                "endpoint.b",
              ),
              walk,
            ),
            new Set(),
          );

        expect(
          outcome.accepted,
        ).toBe(false);

        if (
          outcome.accepted
        ) {
          throw new Error(
            "Traversal deveria ter sido rejeitado.",
          );
        }

        expect(
          outcome.reason,
        ).toBe(
          "missing-traversal-capability",
        );

        expect(
          outcome.details,
        ).toEqual({
          capabilityId:
            "capability.alpha",
        });
      },
    );

    it(
      "TraversalRule rejeita configuração duplicada",
      () => {
        expect(() =>
          new TraversalRule({
            id:
              createTraversalRuleId(
                "traversal.invalid",
              ),
            allowedModeIds: [
              walk,
              walk,
            ],
          }),
        ).toThrow(
          TraversalRuleError,
        );
      },
    );
  },
);

describe(
  "Etapa 59 — RequirementRule",
  () => {
    const hasKey =
      createRequirementId(
        "requirement.has-key",
      );

    const trusted =
      createRequirementId(
        "requirement.trusted",
      );

    it(
      "mode all exige todos os facts resolvidos como true",
      () => {
        const rule =
          new RequirementRule({
            id:
              createRequirementRuleId(
                "requirement-rule.door",
              ),
            requirementIds: [
              trusted,
              hasKey,
            ],
          });

        const outcome =
          rule.evaluate(
            new Map([
              [
                hasKey,
                true,
              ],
              [
                trusted,
                true,
              ],
            ]),
          );

        expect(
          outcome.accepted,
        ).toBe(true);

        if (
          !outcome.accepted
        ) {
          throw new Error(
            "RequirementRule deveria ter sido aceito.",
          );
        }

        expect(
          outcome.value,
        ).toEqual({
          ruleId:
            "requirement-rule.door",
          mode: "all",
          satisfiedCount: 2,
          totalCount: 2,
        });
      },
    );

    it(
      "resolution ausente retorna unresolved antes de avaliar satisfação",
      () => {
        const rule =
          new RequirementRule({
            id:
              createRequirementRuleId(
                "requirement-rule.door",
              ),
            requirementIds: [
              trusted,
              hasKey,
            ],
          });

        const outcome =
          rule.evaluate(
            new Map([
              [
                trusted,
                false,
              ],
            ]),
          );

        expect(
          outcome.accepted,
        ).toBe(false);

        if (
          outcome.accepted
        ) {
          throw new Error(
            "RequirementRule deveria ter sido rejeitado.",
          );
        }

        expect(
          outcome.reason,
        ).toBe(
          "requirements-unresolved",
        );

        expect(
          outcome.details,
        ).toEqual({
          requirementId:
            "requirement.has-key",
        });
      },
    );

    it(
      "mode any aceita quando pelo menos um requirement é true",
      () => {
        const rule =
          new RequirementRule({
            id:
              createRequirementRuleId(
                "requirement-rule.entry",
              ),
            mode: "any",
            requirementIds: [
              hasKey,
              trusted,
            ],
          });

        const outcome =
          rule.evaluate(
            new Map([
              [
                hasKey,
                false,
              ],
              [
                trusted,
                true,
              ],
            ]),
          );

        expect(
          outcome.accepted,
        ).toBe(true);
      },
    );

    it(
      "mode any rejeita quando todos são false",
      () => {
        const rule =
          new RequirementRule({
            id:
              createRequirementRuleId(
                "requirement-rule.entry",
              ),
            mode: "any",
            requirementIds: [
              hasKey,
              trusted,
            ],
          });

        const outcome =
          rule.evaluate(
            new Map([
              [
                hasKey,
                false,
              ],
              [
                trusted,
                false,
              ],
            ]),
          );

        expect(
          outcome.accepted,
        ).toBe(false);

        if (
          outcome.accepted
        ) {
          throw new Error(
            "RequirementRule deveria ter sido rejeitado.",
          );
        }

        expect(
          outcome.reason,
        ).toBe(
          "requirements-unsatisfied",
        );
      },
    );

    it(
      "resolution desconhecida é erro estrutural",
      () => {
        const rule =
          new RequirementRule({
            id:
              createRequirementRuleId(
                "requirement-rule.entry",
              ),
            requirementIds: [
              hasKey,
            ],
          });

        expect(() =>
          rule.evaluate(
            new Map([
              [
                hasKey,
                true,
              ],
              [
                createRequirementId(
                  "requirement.unknown",
                ),
                true,
              ],
            ]),
          ),
        ).toThrow(
          RequirementRuleError,
        );
      },
    );
  },
);
