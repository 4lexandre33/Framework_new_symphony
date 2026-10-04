// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createFactionId,
  createFactionRelation,
  createReputationSubjectId,
  createReputationSubjectRef,
  createReputationSubjectTypeId,
  createRelationshipId,
  createRelationshipSubjectId,
  createRelationshipSubjectRef,
  createRelationshipSubjectTypeId,
  createRelationshipTypeId,
  FactionMatrix,
  FactionMatrixError,
  Reputation,
  ReputationError,
  Relationship,
  RelationshipError,
} from "../src/domain/relations";

describe(
  "Etapa 55 — FactionRelation / FactionMatrix",
  () => {
    it(
      "mantém relações direcionais independentes",
      () => {
        const guild =
          createFactionId(
            "faction.guild",
          );

        const empire =
          createFactionId(
            "faction.empire",
          );

        const matrix =
          new FactionMatrix();

        matrix.set(
          guild,
          empire,
          "friendly",
        );

        expect(
          matrix.get(
            guild,
            empire,
          ),
        ).toBe("friendly");

        expect(
          matrix.get(
            empire,
            guild,
          ),
        ).toBe("neutral");

        expect(
          matrix.hasExplicit(
            empire,
            guild,
          ),
        ).toBe(false);
      },
    );

    it(
      "permite fallback configurável sem criar entrada",
      () => {
        const a =
          createFactionId(
            "faction.a",
          );

        const b =
          createFactionId(
            "faction.b",
          );

        const matrix =
          new FactionMatrix(
            "unfriendly",
          );

        expect(
          matrix.get(a, b),
        ).toBe("unfriendly");

        expect(matrix.size).toBe(0);
      },
    );

    it(
      "setRelation sobrescreve sem aumentar size duas vezes",
      () => {
        const a =
          createFactionId(
            "faction.a",
          );

        const b =
          createFactionId(
            "faction.b",
          );

        const matrix =
          new FactionMatrix();

        matrix.setRelation(
          createFactionRelation(
            a,
            b,
            "hostile",
          ),
        );

        matrix.set(
          a,
          b,
          "allied",
        );

        expect(matrix.size).toBe(1);

        expect(
          matrix.get(a, b),
        ).toBe("allied");
      },
    );

    it(
      "snapshot é ordenado e round-trip preserva matriz",
      () => {
        const matrix =
          new FactionMatrix();

        matrix.set(
          createFactionId(
            "faction.zeta",
          ),
          createFactionId(
            "faction.beta",
          ),
          "hostile",
        );

        matrix.set(
          createFactionId(
            "faction.alpha",
          ),
          createFactionId(
            "faction.zeta",
          ),
          "friendly",
        );

        matrix.set(
          createFactionId(
            "faction.alpha",
          ),
          createFactionId(
            "faction.beta",
          ),
          "allied",
        );

        const snapshot =
          matrix.toSnapshot();

        expect(
          snapshot.relations.map(
            (relation) =>
              `${relation.sourceFactionId}->${relation.targetFactionId}`,
          ),
        ).toEqual([
          "faction.alpha->faction.beta",
          "faction.alpha->faction.zeta",
          "faction.zeta->faction.beta",
        ]);

        expect(
          FactionMatrix
            .fromSnapshot(
              snapshot,
            )
            .toSnapshot(),
        ).toEqual(snapshot);
      },
    );

    it(
      "restore rejeita par duplicado",
      () => {
        const relation = {
          sourceFactionId:
            "faction.a",
          targetFactionId:
            "faction.b",
          disposition:
            "neutral" as const,
        };

        expect(() =>
          FactionMatrix
            .fromSnapshot({
              defaultDisposition:
                "neutral",
              relations: [
                relation,
                relation,
              ],
            }),
        ).toThrow(
          FactionMatrixError,
        );
      },
    );

    it(
      "delete remove somente direção solicitada",
      () => {
        const a =
          createFactionId(
            "faction.a",
          );

        const b =
          createFactionId(
            "faction.b",
          );

        const matrix =
          new FactionMatrix();

        matrix.set(
          a,
          b,
          "friendly",
        );

        matrix.set(
          b,
          a,
          "hostile",
        );

        expect(
          matrix.delete(a, b),
        ).toBe(true);

        expect(
          matrix.get(a, b),
        ).toBe("neutral");

        expect(
          matrix.get(b, a),
        ).toBe("hostile");

        expect(matrix.size).toBe(1);
      },
    );
  },
);

describe(
  "Etapa 55 — Reputation",
  () => {
    function subject() {
      return createReputationSubjectRef(
        createReputationSubjectTypeId(
          "subject.agent",
        ),
        createReputationSubjectId(
          "agent.player",
        ),
      );
    }

    it(
      "usa range default -100..100",
      () => {
        const reputation =
          new Reputation({
            subject:
              subject(),
            factionId:
              createFactionId(
                "faction.guild",
              ),
          });

        expect(
          reputation.current,
        ).toBe(0);

        expect(reputation.min).toBe(
          -100,
        );

        expect(reputation.max).toBe(
          100,
        );

        expect(
          reputation.normalized01,
        ).toBe(0.5);
      },
    );

    it(
      "adjust satura e retorna delta aplicado",
      () => {
        const reputation =
          new Reputation({
            subject:
              subject(),
            factionId:
              createFactionId(
                "faction.guild",
              ),
            current: 90,
          });

        expect(
          reputation.adjust(50),
        ).toBe(10);

        expect(
          reputation.current,
        ).toBe(100);

        expect(
          reputation.adjust(
            -250,
          ),
        ).toBe(-200);

        expect(
          reputation.current,
        ).toBe(-100);
      },
    );

    it(
      "set é estrito",
      () => {
        const reputation =
          new Reputation({
            subject:
              subject(),
            factionId:
              createFactionId(
                "faction.guild",
              ),
          });

        reputation.set(25);

        expect(
          reputation.current,
        ).toBe(25);

        expect(() =>
          reputation.set(101),
        ).toThrow(
          ReputationError,
        );
      },
    );

    it(
      "suporta range custom e snapshot round-trip",
      () => {
        const reputation =
          new Reputation({
            subject:
              subject(),
            factionId:
              createFactionId(
                "faction.empire",
              ),
            min: -1000,
            max: 1000,
            current: 250,
          });

        const snapshot =
          reputation.toSnapshot();

        expect(
          Reputation
            .fromSnapshot(
              snapshot,
            )
            .toSnapshot(),
        ).toEqual(snapshot);
      },
    );
  },
);

describe(
  "Etapa 55 — Relationship",
  () => {
    function ref(
      id: string,
    ) {
      return createRelationshipSubjectRef(
        createRelationshipSubjectTypeId(
          "subject.agent",
        ),
        createRelationshipSubjectId(
          id,
        ),
      );
    }

    it(
      "modela edge direcional tipado",
      () => {
        const relationship =
          new Relationship({
            id:
              createRelationshipId(
                "relationship.alex-bia",
              ),
            typeId:
              createRelationshipTypeId(
                "relationship.friend",
              ),
            source:
              ref("agent.alex"),
            target:
              ref("agent.bia"),
            strength: 40,
          });

        expect(
          relationship.strength,
        ).toBe(40);

        expect(
          relationship.source
            .subjectId,
        ).toBe("agent.alex");

        expect(
          relationship.target
            .subjectId,
        ).toBe("agent.bia");
      },
    );

    it(
      "adjustStrength satura no range canônico",
      () => {
        const relationship =
          new Relationship({
            id:
              createRelationshipId(
                "relationship.rival",
              ),
            typeId:
              createRelationshipTypeId(
                "relationship.rival",
              ),
            source:
              ref("agent.a"),
            target:
              ref("agent.b"),
            strength: 90,
          });

        expect(
          relationship
            .adjustStrength(50),
        ).toBe(10);

        expect(
          relationship.strength,
        ).toBe(100);

        expect(
          relationship
            .adjustStrength(
              -500,
            ),
        ).toBe(-200);

        expect(
          relationship.strength,
        ).toBe(-100);
      },
    );

    it(
      "rejeita self relationship",
      () => {
        const self =
          ref("agent.self");

        expect(() =>
          new Relationship({
            id:
              createRelationshipId(
                "relationship.self",
              ),
            typeId:
              createRelationshipTypeId(
                "relationship.friend",
              ),
            source: self,
            target: self,
          }),
        ).toThrow(
          RelationshipError,
        );
      },
    );

    it(
      "snapshot round-trip preserva relação",
      () => {
        const original =
          new Relationship({
            id:
              createRelationshipId(
                "relationship.mentor",
              ),
            typeId:
              createRelationshipTypeId(
                "relationship.mentor",
              ),
            source:
              ref("agent.mentor"),
            target:
              ref("agent.student"),
            strength: 75,
          });

        const snapshot =
          original.toSnapshot();

        expect(
          Relationship
            .fromSnapshot(
              snapshot,
            )
            .toSnapshot(),
        ).toEqual(snapshot);
      },
    );

    it(
      "setStrength rejeita fora do range",
      () => {
        const relationship =
          new Relationship({
            id:
              createRelationshipId(
                "relationship.test",
              ),
            typeId:
              createRelationshipTypeId(
                "relationship.friend",
              ),
            source:
              ref("agent.a"),
            target:
              ref("agent.b"),
          });

        expect(() =>
          relationship.setStrength(
            101,
          ),
        ).toThrow(
          RelationshipError,
        );
      },
    );
  },
);
