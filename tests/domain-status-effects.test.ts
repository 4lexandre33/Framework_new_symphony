// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createStatusEffectId,
  createStatusEffectInstanceId,
  createStatusEffectSourceId,
  createStatusEffectSourceRef,
  createStatusEffectSourceTypeId,
  StatusEffect,
  StatusEffectError,
  StatusEffectInstance,
  StatusEffectInstanceError,
  StatusEffectSet,
  StatusEffectSetError,
} from "../src/domain/mechanics";

import {
  createDomainDuration,
} from "../src/domain/time";

function timedEffect(
  id: string,
  policy:
    | "reject"
    | "stack"
    | "refresh"
    | "stack-and-refresh",
  maxStacks = 1,
  duration = 10,
): StatusEffect {
  return new StatusEffect({
    id:
      createStatusEffectId(id),
    name: id,
    duration:
      createDomainDuration(
        duration,
      ),
    maxStacks,
    stackingPolicy:
      policy,
  });
}

function instanceId(
  value: string,
) {
  return createStatusEffectInstanceId(
    value,
  );
}

describe(
  "Etapa 51 — StatusEffect",
  () => {
    it(
      "cria definição permanente e faz snapshot",
      () => {
        const effect =
          new StatusEffect({
            id:
              createStatusEffectId(
                "status.invulnerable",
              ),
            name:
              "Invulnerable",
          });

        expect(
          effect.isTimed,
        ).toBe(false);

        expect(
          effect.toSnapshot(),
        ).toEqual({
          id:
            "status.invulnerable",
          name:
            "Invulnerable",
          durationTicks: null,
          maxStacks: 1,
          stackingPolicy:
            "reject",
        });
      },
    );

    it(
      "valida policy, duration e maxStacks",
      () => {
        expect(() =>
          new StatusEffect({
            id:
              createStatusEffectId(
                "status.bad-refresh",
              ),
            name:
              "Bad Refresh",
            stackingPolicy:
              "refresh",
          }),
        ).toThrow(
          StatusEffectError,
        );

        expect(() =>
          new StatusEffect({
            id:
              createStatusEffectId(
                "status.bad-stack",
              ),
            name:
              "Bad Stack",
            maxStacks: 2,
            stackingPolicy:
              "reject",
          }),
        ).toThrow(
          StatusEffectError,
        );
      },
    );

    it(
      "round-trip da definição é determinístico",
      () => {
        const original =
          timedEffect(
            "status.poison",
            "stack-and-refresh",
            5,
            30,
          );

        expect(
          StatusEffect
            .fromSnapshot(
              original.toSnapshot(),
            )
            .toSnapshot(),
        ).toEqual(
          original.toSnapshot(),
        );
      },
    );
  },
);

describe(
  "Etapa 51 — StatusEffectInstance",
  () => {
    it(
      "expira por elapsed determinístico",
      () => {
        const instance =
          new StatusEffectInstance({
            id:
              instanceId(
                "stun.1",
              ),
            effect:
              timedEffect(
                "status.stunned",
                "reject",
                1,
                10,
              ),
          });

        expect(
          instance.advance(
            createDomainDuration(
              4,
            ),
          ),
        ).toBe(4);

        expect(
          instance.remaining,
        ).toBe(6);

        expect(
          instance.advance(
            createDomainDuration(
              100,
            ),
          ),
        ).toBe(6);

        expect(
          instance.status,
        ).toBe("expired");

        expect(
          instance.advance(
            createDomainDuration(
              5,
            ),
          ),
        ).toBe(0);
      },
    );

    it(
      "effect permanente só termina por remove",
      () => {
        const instance =
          new StatusEffectInstance({
            id:
              instanceId(
                "curse.1",
              ),
            effect:
              new StatusEffect({
                id:
                  createStatusEffectId(
                    "status.curse",
                  ),
                name: "Curse",
              }),
          });

        expect(
          instance.remaining,
        ).toBeNull();

        expect(
          instance.advance(
            createDomainDuration(
              100,
            ),
          ),
        ).toBe(0);

        expect(
          instance.status,
        ).toBe("active");

        expect(
          instance.remove(),
        ).toBe(true);

        expect(
          instance.status,
        ).toBe("removed");
      },
    );

    it(
      "preserva source lógico opaco",
      () => {
        const source =
          createStatusEffectSourceRef(
            createStatusEffectSourceTypeId(
              "source.world-object",
            ),
            createStatusEffectSourceId(
              "world-object.fire-trap",
            ),
          );

        const instance =
          new StatusEffectInstance({
            id:
              instanceId(
                "burn.1",
              ),
            effect:
              timedEffect(
                "status.burning",
                "refresh",
              ),
            source,
          });

        expect(
          instance.source,
        ).toEqual({
          typeId:
            "source.world-object",
          sourceId:
            "world-object.fire-trap",
        });
      },
    );

    it(
      "round-trip active e expired",
      () => {
        const effect =
          timedEffect(
            "status.silenced",
            "refresh",
            1,
            8,
          );

        const active =
          new StatusEffectInstance({
            id:
              instanceId(
                "silence.1",
              ),
            effect,
          });

        active.advance(
          createDomainDuration(3),
        );

        expect(
          StatusEffectInstance
            .fromSnapshot(
              effect,
              active.toSnapshot(),
            )
            .toSnapshot(),
        ).toEqual(
          active.toSnapshot(),
        );

        active.advance(
          createDomainDuration(5),
        );

        expect(
          StatusEffectInstance
            .fromSnapshot(
              effect,
              active.toSnapshot(),
            )
            .status,
        ).toBe("expired");
      },
    );

    it(
      "rejeita restore com effect diferente",
      () => {
        const first =
          timedEffect(
            "status.first",
            "reject",
          );

        const second =
          timedEffect(
            "status.second",
            "reject",
          );

        const instance =
          new StatusEffectInstance({
            id:
              instanceId("first"),
            effect: first,
          });

        expect(() =>
          StatusEffectInstance
            .fromSnapshot(
              second,
              instance
                .toSnapshot(),
            ),
        ).toThrow(
          StatusEffectInstanceError,
        );
      },
    );
  },
);

describe(
  "Etapa 51 — stacking policies",
  () => {
    it(
      "reject mantém instância active",
      () => {
        const effect =
          timedEffect(
            "status.stun",
            "reject",
          );

        const set =
          new StatusEffectSet();

        const first =
          set.apply({
            effect,
            instanceId:
              instanceId("stun.1"),
          });

        const second =
          set.apply({
            effect,
            instanceId:
              instanceId("stun.2"),
          });

        expect(
          first.outcome,
        ).toBe("applied");

        expect(
          second.outcome,
        ).toBe("rejected");

        expect(
          second.instance,
        ).toBe(
          first.instance,
        );
      },
    );

    it(
      "stack aumenta até maxStacks sem refresh",
      () => {
        const effect =
          timedEffect(
            "status.poison",
            "stack",
            3,
            10,
          );

        const set =
          new StatusEffectSet();

        const first =
          set.apply({
            effect,
            instanceId:
              instanceId(
                "poison.1",
              ),
          });

        first.instance.advance(
          createDomainDuration(4),
        );

        expect(
          set.apply({
            effect,
            instanceId:
              instanceId(
                "poison.2",
              ),
          }).outcome,
        ).toBe("stacked");

        expect(
          first.instance.stacks,
        ).toBe(2);

        expect(
          first.instance.remaining,
        ).toBe(6);

        set.apply({
          effect,
          instanceId:
            instanceId(
              "poison.3",
            ),
        });

        expect(
          set.apply({
            effect,
            instanceId:
              instanceId(
                "poison.4",
              ),
          }).outcome,
        ).toBe("rejected");

        expect(
          first.instance.stacks,
        ).toBe(3);
      },
    );

    it(
      "refresh reinicia duração sem stack",
      () => {
        const effect =
          timedEffect(
            "status.burning",
            "refresh",
            1,
            12,
          );

        const set =
          new StatusEffectSet();

        const first =
          set.apply({
            effect,
            instanceId:
              instanceId("burn.1"),
          });

        first.instance.advance(
          createDomainDuration(7),
        );

        expect(
          first.instance.remaining,
        ).toBe(5);

        const reapplied =
          set.apply({
            effect,
            instanceId:
              instanceId("burn.2"),
          });

        expect(
          reapplied.outcome,
        ).toBe("refreshed");

        expect(
          first.instance.remaining,
        ).toBe(12);

        expect(
          first.instance.stacks,
        ).toBe(1);
      },
    );

    it(
      "stack-and-refresh empilha e refresha inclusive no max",
      () => {
        const effect =
          timedEffect(
            "status.bleeding",
            "stack-and-refresh",
            2,
            10,
          );

        const set =
          new StatusEffectSet();

        const first =
          set.apply({
            effect,
            instanceId:
              instanceId(
                "bleed.1",
              ),
          });

        first.instance.advance(
          createDomainDuration(8),
        );

        const stacked =
          set.apply({
            effect,
            instanceId:
              instanceId(
                "bleed.2",
              ),
          });

        expect(
          stacked.outcome,
        ).toBe(
          "stacked-and-refreshed",
        );

        expect(
          first.instance.stacks,
        ).toBe(2);

        expect(
          first.instance.remaining,
        ).toBe(10);

        first.instance.advance(
          createDomainDuration(6),
        );

        const atMax =
          set.apply({
            effect,
            instanceId:
              instanceId(
                "bleed.3",
              ),
          });

        expect(
          atMax.outcome,
        ).toBe("refreshed");

        expect(
          atMax.addedStacks,
        ).toBe(0);

        expect(
          first.instance.remaining,
        ).toBe(10);
      },
    );
  },
);

describe(
  "Etapa 51 — StatusEffectSet",
  () => {
    it(
      "advance expira temporário e prune remove terminal",
      () => {
        const timed =
          timedEffect(
            "status.timed",
            "reject",
            1,
            5,
          );

        const permanent =
          new StatusEffect({
            id:
              createStatusEffectId(
                "status.permanent",
              ),
            name:
              "Permanent",
          });

        const set =
          new StatusEffectSet();

        set.apply({
          effect: timed,
          instanceId:
            instanceId("timed.1"),
        });

        set.apply({
          effect: permanent,
          instanceId:
            instanceId(
              "permanent.1",
            ),
        });

        set.advance(
          createDomainDuration(5),
        );

        expect(
          set.hasActive(
            timed.id,
          ),
        ).toBe(false);

        expect(
          set.hasActive(
            permanent.id,
          ),
        ).toBe(true);

        expect(
          set.pruneTerminal(),
        ).toBe(1);
      },
    );

    it(
      "remove preserva lifecycle até prune",
      () => {
        const effect =
          new StatusEffect({
            id:
              createStatusEffectId(
                "status.aura",
              ),
            name: "Aura",
          });

        const set =
          new StatusEffectSet();

        set.apply({
          effect,
          instanceId:
            instanceId("aura.1"),
        });

        expect(
          set.remove(effect.id),
        ).toBe(true);

        expect(
          set.get(effect.id)
            ?.status,
        ).toBe("removed");

        expect(
          set.pruneTerminal(),
        ).toBe(1);

        expect(set.size).toBe(0);
      },
    );

    it(
      "reaplicação após terminal cria nova instância",
      () => {
        const effect =
          timedEffect(
            "status.short",
            "reject",
            1,
            1,
          );

        const set =
          new StatusEffectSet();

        const first =
          set.apply({
            effect,
            instanceId:
              instanceId("short.1"),
          });

        set.advance(
          createDomainDuration(1),
        );

        const second =
          set.apply({
            effect,
            instanceId:
              instanceId("short.2"),
          });

        expect(
          first.instance.status,
        ).toBe("expired");

        expect(
          second.outcome,
        ).toBe("applied");

        expect(
          second.instance.id,
        ).toBe("short.2");

        expect(
          second.instance,
        ).not.toBe(
          first.instance,
        );
      },
    );

    it(
      "rejeita definição conflitante no mesmo id",
      () => {
        const id =
          createStatusEffectId(
            "status.conflict",
          );

        const set =
          new StatusEffectSet();

        set.apply({
          effect:
            new StatusEffect({
              id,
              name:
                "Conflict",
            }),
          instanceId:
            instanceId(
              "conflict.1",
            ),
        });

        expect(() =>
          set.apply({
            effect:
              new StatusEffect({
                id,
                name:
                  "Changed",
              }),
            instanceId:
              instanceId(
                "conflict.2",
              ),
          }),
        ).toThrow(
          StatusEffectSetError,
        );
      },
    );

    it(
      "snapshot é ordenado e restaura o set",
      () => {
        const zeta =
          timedEffect(
            "status.zeta",
            "stack",
            3,
            20,
          );

        const alpha =
          new StatusEffect({
            id:
              createStatusEffectId(
                "status.alpha",
              ),
            name: "Alpha",
          });

        const set =
          new StatusEffectSet();

        const z =
          set.apply({
            effect: zeta,
            instanceId:
              instanceId("zeta.1"),
          });

        set.apply({
          effect: alpha,
          instanceId:
            instanceId("alpha.1"),
        });

        z.instance.advance(
          createDomainDuration(7),
        );

        set.apply({
          effect: zeta,
          instanceId:
            instanceId("zeta.2"),
        });

        const snapshot =
          set.toSnapshot();

        expect(
          snapshot.entries
            .map(
              (entry) =>
                entry.effect.id,
            ),
        ).toEqual([
          "status.alpha",
          "status.zeta",
        ]);

        const restored =
          StatusEffectSet
            .fromSnapshot(
              snapshot,
            );

        expect(
          restored.toSnapshot(),
        ).toEqual(snapshot);
      },
    );

    it(
      "forEach não exige snapshot",
      () => {
        const set =
          new StatusEffectSet();

        set.apply({
          effect:
            new StatusEffect({
              id:
                createStatusEffectId(
                  "status.one",
                ),
              name: "One",
            }),
          instanceId:
            instanceId("one"),
        });

        set.apply({
          effect:
            new StatusEffect({
              id:
                createStatusEffectId(
                  "status.two",
                ),
              name: "Two",
            }),
          instanceId:
            instanceId("two"),
        });

        let count = 0;

        set.forEach(() => {
          count += 1;
        });

        expect(count).toBe(2);
      },
    );
  },
);
