// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  cloneStateValue,
  createStateKey,
  isStateValue,
  StateStore,
  StateStoreError,
  StateValueError,
  stateValueEquals,
} from "../src/domain/state";

describe(
  "Etapa 47 — StateValue",
  () => {
    it(
      "aceita primitives, arrays e objetos serializáveis",
      () => {
        expect(
          isStateValue(null),
        ).toBe(true);

        expect(
          isStateValue(true),
        ).toBe(true);

        expect(
          isStateValue(42),
        ).toBe(true);

        expect(
          isStateValue(
            "active",
          ),
        ).toBe(true);

        expect(
          isStateValue({
            nested: [
              1,
              "two",
              false,
              null,
            ],
          }),
        ).toBe(true);
      },
    );

    it(
      "rejeita tipos não serializáveis e números não finitos",
      () => {
        expect(
          isStateValue(
            undefined,
          ),
        ).toBe(false);

        expect(
          isStateValue(
            Number.NaN,
          ),
        ).toBe(false);

        expect(
          isStateValue(
            Number.POSITIVE_INFINITY,
          ),
        ).toBe(false);

        expect(
          isStateValue(
            new Date(),
          ),
        ).toBe(false);

        expect(
          isStateValue(
            new Map(),
          ),
        ).toBe(false);

        expect(() =>
          cloneStateValue(
            Number.NaN,
          ),
        ).toThrow(
          StateValueError,
        );
      },
    );

    it(
      "rejeita referência cíclica",
      () => {
        const cyclic:
          Record<
            string,
            unknown
          > = {};

        cyclic.self = cyclic;

        expect(() =>
          cloneStateValue(
            cyclic,
          ),
        ).toThrow(
          StateValueError,
        );
      },
    );

    it(
      "copia e congela profundamente",
      () => {
        const source = {
          nested: {
            values: [
              1,
              2,
            ],
          },
        };

        const cloned =
          cloneStateValue(
            source,
          );

        source.nested
          .values[0] = 99;

        expect(cloned).toEqual({
          nested: {
            values: [
              1,
              2,
            ],
          },
        });

        expect(
          Object.isFrozen(
            cloned,
          ),
        ).toBe(true);

        if (
          cloned !== null &&
          typeof cloned ===
            "object" &&
          !Array.isArray(
            cloned,
          )
        ) {
          const nested =
            cloned.nested;

          expect(
            Object.isFrozen(
              nested,
            ),
          ).toBe(true);
        }
      },
    );

    it(
      "compara valores estruturalmente",
      () => {
        const left =
          cloneStateValue({
            a: 1,
            b: [
              true,
              "x",
            ],
          });

        const right =
          cloneStateValue({
            b: [
              true,
              "x",
            ],
            a: 1,
          });

        expect(
          stateValueEquals(
            left,
            right,
          ),
        ).toBe(true);

        expect(
          stateValueEquals(
            left,
            cloneStateValue({
              a: 2,
              b: [
                true,
                "x",
              ],
            }),
          ),
        ).toBe(false);
      },
    );
  },
);

describe(
  "Etapa 47 — StateStore",
  () => {
    it(
      "faz has/read/set/delete/clear em facts tipados",
      () => {
        const store =
          new StateStore();

        const openKey =
          createStateKey<boolean>(
            "door.castle.open",
          );

        const countKey =
          createStateKey<number>(
            "quest.crystals.count",
          );

        expect(
          store.isEmpty,
        ).toBe(true);

        expect(
          store.set(
            openKey,
            true,
          ),
        ).toBe(true);

        expect(
          store.set(
            countKey,
            3,
          ),
        ).toBe(3);

        expect(
          store.has(openKey),
        ).toBe(true);

        expect(
          store.read(
            openKey,
          ),
        ).toBe(true);

        expect(
          store.read(
            countKey,
          ),
        ).toBe(3);

        expect(store.size).toBe(
          2,
        );

        expect(
          store.delete(
            openKey,
          ),
        ).toBe(true);

        expect(
          store.has(openKey),
        ).toBe(false);

        store.clear();

        expect(
          store.isEmpty,
        ).toBe(true);
      },
    );

    it(
      "impede mutação externa após set",
      () => {
        const store =
          new StateStore();

        const key =
          createStateKey(
            "world.flags",
          );

        const source = {
          power: true,
          gates: [
            "north",
            "south",
          ],
        };

        store.set(
          key,
          source,
        );

        source.power = false;
        source.gates.push(
          "east",
        );

        expect(
          store.read(key),
        ).toEqual({
          power: true,
          gates: [
            "north",
            "south",
          ],
        });
      },
    );

    it(
      "compare usa igualdade estrutural",
      () => {
        const store =
          new StateStore();

        const key =
          createStateKey(
            "world.composite",
          );

        store.set(
          key,
          {
            enabled: true,
            values: [
              1,
              2,
              3,
            ],
          },
        );

        expect(
          store.compare(
            key,
            {
              values: [
                1,
                2,
                3,
              ],
              enabled: true,
            },
          ),
        ).toBe(true);

        expect(
          store.compare(
            key,
            {
              enabled: false,
              values: [
                1,
                2,
                3,
              ],
            },
          ),
        ).toBe(false);
      },
    );

    it(
      "produz snapshot determinístico ordenado por key",
      () => {
        const store =
          new StateStore();

        store.set(
          createStateKey(
            "state.zeta",
          ),
          2,
        );

        store.set(
          createStateKey(
            "state.alpha",
          ),
          {
            active: true,
          },
        );

        expect(
          store.toSnapshot(),
        ).toEqual({
          entries: [
            {
              key:
                "state.alpha",
              value: {
                active: true,
              },
            },
            {
              key:
                "state.zeta",
              value: 2,
            },
          ],
        });
      },
    );

    it(
      "faz round-trip de snapshot",
      () => {
        const original =
          new StateStore();

        original.set(
          createStateKey(
            "boss.dragon.defeated",
          ),
          true,
        );

        original.set(
          createStateKey(
            "village.power",
          ),
          {
            restored: true,
            level: 3,
          },
        );

        const snapshot =
          original.toSnapshot();

        const restored =
          StateStore.fromSnapshot(
            snapshot,
          );

        expect(
          restored.toSnapshot(),
        ).toEqual(snapshot);
      },
    );

    it(
      "rejeita duplicate keys em snapshot",
      () => {
        const key =
          createStateKey(
            "duplicate.key",
          );

        expect(() =>
          StateStore.fromSnapshot({
            entries: [
              {
                key,
                value: true,
              },
              {
                key,
                value: false,
              },
            ],
          }),
        ).toThrow(
          StateStoreError,
        );
      },
    );

    it(
      "forEach percorre sem exigir snapshot",
      () => {
        const store =
          new StateStore();

        store.set(
          createStateKey(
            "state.one",
          ),
          1,
        );

        store.set(
          createStateKey(
            "state.two",
          ),
          2,
        );

        let total = 0;

        store.forEach(
          (_key, value) => {
            if (
              typeof value ===
              "number"
            ) {
              total += value;
            }
          },
        );

        expect(total).toBe(3);
      },
    );
  },
);
