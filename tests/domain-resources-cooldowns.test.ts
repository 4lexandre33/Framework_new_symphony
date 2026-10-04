// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  Cooldown,
  CooldownError,
  CooldownSet,
  CooldownSetError,
  createCooldownId,
  createResourceId,
  ResourcePool,
  ResourcePoolError,
} from "../src/domain/mechanics";

import {
  createDomainDuration,
} from "../src/domain/time";

describe(
  "Etapa 53 — ResourcePool",
  () => {
    it(
      "cria cheio por padrão",
      () => {
        const pool =
          new ResourcePool({
            id:
              createResourceId(
                "resource.mana",
              ),
            max: 100,
          });

        expect(pool.current).toBe(
          100,
        );

        expect(pool.max).toBe(100);

        expect(pool.isFull).toBe(
          true,
        );

        expect(pool.ratio01).toBe(
          1,
        );
      },
    );

    it(
      "trySpend é atômico",
      () => {
        const pool =
          new ResourcePool({
            id:
              createResourceId(
                "resource.stamina",
              ),
            max: 50,
            current: 30,
          });

        expect(
          pool.trySpend(20),
        ).toBe(true);

        expect(pool.current).toBe(
          10,
        );

        expect(
          pool.trySpend(11),
        ).toBe(false);

        expect(pool.current).toBe(
          10,
        );
      },
    );

    it(
      "gain satura no max e retorna aplicado",
      () => {
        const pool =
          new ResourcePool({
            id:
              createResourceId(
                "resource.energy",
              ),
            max: 100,
            current: 90,
          });

        expect(
          pool.gain(50),
        ).toBe(10);

        expect(pool.current).toBe(
          100,
        );

        expect(
          pool.gain(1),
        ).toBe(0);
      },
    );

    it(
      "setMax faz clamp ou erro explícito",
      () => {
        const pool =
          new ResourcePool({
            id:
              createResourceId(
                "resource.energy",
              ),
            max: 100,
            current: 80,
          });

        pool.setMax(50);

        expect(pool.max).toBe(50);

        expect(pool.current).toBe(
          50,
        );

        expect(() =>
          pool.setMax(
            20,
            false,
          ),
        ).toThrow(
          ResourcePoolError,
        );
      },
    );

    it(
      "suporta recurso fracionário finito",
      () => {
        const pool =
          new ResourcePool({
            id:
              createResourceId(
                "resource.charge",
              ),
            max: 1,
            current: 0.25,
          });

        expect(
          pool.gain(0.5),
        ).toBe(0.5);

        expect(pool.current).toBe(
          0.75,
        );
      },
    );

    it(
      "rejeita negativos, NaN e current > max",
      () => {
        expect(() =>
          new ResourcePool({
            id:
              createResourceId(
                "resource.invalid",
              ),
            max: 0,
          }),
        ).toThrow(
          ResourcePoolError,
        );

        expect(() =>
          new ResourcePool({
            id:
              createResourceId(
                "resource.invalid",
              ),
            max: 10,
            current: 11,
          }),
        ).toThrow(
          ResourcePoolError,
        );

        const pool =
          new ResourcePool({
            id:
              createResourceId(
                "resource.valid",
              ),
            max: 10,
          });

        expect(() =>
          pool.gain(
            Number.NaN,
          ),
        ).toThrow(
          ResourcePoolError,
        );
      },
    );

    it(
      "round-trip snapshot preserva estado",
      () => {
        const pool =
          new ResourcePool({
            id:
              createResourceId(
                "resource.mana",
              ),
            max: 120,
            current: 35,
          });

        const snapshot =
          pool.toSnapshot();

        expect(
          ResourcePool
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
  "Etapa 53 — Cooldown",
  () => {
    it(
      "começa ready e start inicia contagem",
      () => {
        const cooldown =
          new Cooldown({
            id:
              createCooldownId(
                "cooldown.dash",
              ),
            duration:
              createDomainDuration(
                10,
              ),
          });

        expect(
          cooldown.isReady,
        ).toBe(true);

        expect(
          cooldown.remaining,
        ).toBe(0);

        cooldown.start();

        expect(
          cooldown.isActive,
        ).toBe(true);

        expect(
          cooldown.remaining,
        ).toBe(10);
      },
    );

    it(
      "advance completa e volta a ready",
      () => {
        const cooldown =
          new Cooldown({
            id:
              createCooldownId(
                "cooldown.attack",
              ),
            duration:
              createDomainDuration(
                8,
              ),
            startActive: true,
          });

        expect(
          cooldown.advance(
            createDomainDuration(
              3,
            ),
          ),
        ).toBe(3);

        expect(
          cooldown.remaining,
        ).toBe(5);

        expect(
          cooldown.advance(
            createDomainDuration(
              100,
            ),
          ),
        ).toBe(5);

        expect(
          cooldown.isReady,
        ).toBe(true);

        expect(
          cooldown.remaining,
        ).toBe(0);
      },
    );

    it(
      "start ativo falha; restart é explícito",
      () => {
        const cooldown =
          new Cooldown({
            id:
              createCooldownId(
                "cooldown.skill",
              ),
            duration:
              createDomainDuration(
                20,
              ),
            startActive: true,
          });

        cooldown.advance(
          createDomainDuration(7),
        );

        expect(() =>
          cooldown.start(),
        ).toThrow(
          CooldownError,
        );

        cooldown.restart();

        expect(
          cooldown.remaining,
        ).toBe(20);
      },
    );

    it(
      "clear cancela cooldown",
      () => {
        const cooldown =
          new Cooldown({
            id:
              createCooldownId(
                "cooldown.clear",
              ),
            duration:
              createDomainDuration(
                10,
              ),
            startActive: true,
          });

        cooldown.advance(
          createDomainDuration(5),
        );

        cooldown.clear();

        expect(
          cooldown.isReady,
        ).toBe(true);

        expect(
          cooldown.elapsed,
        ).toBe(0);
      },
    );

    it(
      "round-trip snapshot preserva cooldown ativo",
      () => {
        const cooldown =
          new Cooldown({
            id:
              createCooldownId(
                "cooldown.snapshot",
              ),
            duration:
              createDomainDuration(
                30,
              ),
            startActive: true,
          });

        cooldown.advance(
          createDomainDuration(9),
        );

        const snapshot =
          cooldown.toSnapshot();

        const restored =
          Cooldown.fromSnapshot(
            snapshot,
          );

        expect(
          restored.toSnapshot(),
        ).toEqual(snapshot);

        expect(
          restored.remaining,
        ).toBe(21);
      },
    );
  },
);

describe(
  "Etapa 53 — CooldownSet",
  () => {
    it(
      "adiciona e consulta cooldowns por id",
      () => {
        const id =
          createCooldownId(
            "cooldown.roll",
          );

        const set =
          new CooldownSet();

        set.add(
          new Cooldown({
            id,
            duration:
              createDomainDuration(
                6,
              ),
          }),
        );

        expect(set.has(id)).toBe(
          true,
        );

        expect(
          set.isReady(id),
        ).toBe(true);

        set.start(id);

        expect(
          set.isReady(id),
        ).toBe(false);
      },
    );

    it(
      "advance percorre cooldowns ativos e ignora ready",
      () => {
        const activeId =
          createCooldownId(
            "cooldown.active",
          );

        const readyId =
          createCooldownId(
            "cooldown.ready",
          );

        const set =
          new CooldownSet();

        set.add(
          new Cooldown({
            id: activeId,
            duration:
              createDomainDuration(
                10,
              ),
            startActive: true,
          }),
        );

        set.add(
          new Cooldown({
            id: readyId,
            duration:
              createDomainDuration(
                10,
              ),
          }),
        );

        set.advance(
          createDomainDuration(4),
        );

        expect(
          set.get(activeId)
            ?.remaining,
        ).toBe(6);

        expect(
          set.get(readyId)
            ?.elapsed,
        ).toBe(0);

        expect(
          set.activeCount,
        ).toBe(1);
      },
    );

    it(
      "rejeita duplicate id e unknown operations",
      () => {
        const id =
          createCooldownId(
            "cooldown.same",
          );

        const set =
          new CooldownSet();

        set.add(
          new Cooldown({
            id,
            duration:
              createDomainDuration(
                5,
              ),
          }),
        );

        expect(() =>
          set.add(
            new Cooldown({
              id,
              duration:
                createDomainDuration(
                  8,
                ),
            }),
          ),
        ).toThrow(
          CooldownSetError,
        );

        expect(() =>
          set.start(
            createCooldownId(
              "cooldown.unknown",
            ),
          ),
        ).toThrow(
          CooldownSetError,
        );
      },
    );

    it(
      "snapshot ordenado e restore determinístico",
      () => {
        const set =
          new CooldownSet();

        set.add(
          new Cooldown({
            id:
              createCooldownId(
                "cooldown.zeta",
              ),
            duration:
              createDomainDuration(
                20,
              ),
            startActive: true,
          }),
        );

        set.add(
          new Cooldown({
            id:
              createCooldownId(
                "cooldown.alpha",
              ),
            duration:
              createDomainDuration(
                5,
              ),
          }),
        );

        set.advance(
          createDomainDuration(7),
        );

        const snapshot =
          set.toSnapshot();

        expect(
          snapshot.cooldowns
            .map(
              (entry) =>
                entry.id,
            ),
        ).toEqual([
          "cooldown.alpha",
          "cooldown.zeta",
        ]);

        expect(
          CooldownSet
            .fromSnapshot(
              snapshot,
            )
            .toSnapshot(),
        ).toEqual(snapshot);
      },
    );

    it(
      "remove/clearCooldown/restart funcionam explicitamente",
      () => {
        const id =
          createCooldownId(
            "cooldown.utility",
          );

        const set =
          new CooldownSet();

        set.add(
          new Cooldown({
            id,
            duration:
              createDomainDuration(
                12,
              ),
          }),
        );

        set.start(id);

        set.advance(
          createDomainDuration(5),
        );

        set.restart(id);

        expect(
          set.get(id)
            ?.remaining,
        ).toBe(12);

        set.clearCooldown(id);

        expect(
          set.isReady(id),
        ).toBe(true);

        expect(
          set.remove(id),
        ).toBe(true);

        expect(set.size).toBe(0);
      },
    );
  },
);
