// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  CurrencyAccount,
  createCurrencyId,
} from "../src/domain/economy";

import {
  createStateKey,
  StateStore,
} from "../src/domain/state";

import {
  createDomainTag,
  TagSet,
} from "../src/domain/tags";

import {
  createSnapshotBundle,
  createSnapshotSlotId,
  createSnapshotTypeId,
  createStandardSnapshotRegistry,
  defineSnapshotCodec,
  DomainSnapshotRegistry,
  DomainSnapshotRegistryError,
  normalizeSnapshotBundle,
  SnapshotBundleError,
  SnapshotCoordinator,
  SnapshotCoordinatorError,
  SnapshotValueError,
  STATE_STORE_SNAPSHOT_TYPE_ID,
  CURRENCY_ACCOUNT_SNAPSHOT_TYPE_ID,
  TAG_SET_SNAPSHOT_TYPE_ID,
  toRuntimeSnapshotCodec,
} from "../src/domain/snapshots";

class Counter {
  public constructor(
    public value: number,
  ) {}
}

describe(
  "Etapa 63 — SnapshotValue / Bundle",
  () => {
    it(
      "normaliza payload e ordena slots deterministicamente",
      () => {
        const bundle =
          createSnapshotBundle([
            {
              slotId:
                createSnapshotSlotId(
                  "slot.z",
                ),
              typeId:
                createSnapshotTypeId(
                  "runtime.test",
                ),
              schemaVersion: 1,
              state: {
                z: 1,
                a: {
                  y: 2,
                  b: 3,
                },
              },
            },
            {
              slotId:
                createSnapshotSlotId(
                  "slot.a",
                ),
              typeId:
                createSnapshotTypeId(
                  "runtime.test",
                ),
              schemaVersion: 1,
              state: [
                2,
                1,
              ],
            },
          ]);

        expect(
          bundle.entries.map(
            (entry) =>
              entry.slotId,
          ),
        ).toEqual([
          "slot.a",
          "slot.z",
        ]);

        expect(
          Object.keys(
            bundle.entries[1]!
              .state as object,
          ),
        ).toEqual([
          "a",
          "z",
        ]);
      },
    );

    it(
      "normaliza bundle vindo de JSON.parse",
      () => {
        const raw =
          JSON.parse(
            JSON.stringify({
              schemaVersion: 1,
              entries: [
                {
                  slotId:
                    "slot.state",
                  typeId:
                    "runtime.state-store",
                  schemaVersion: 1,
                  state: {
                    entries: [],
                  },
                },
              ],
            }),
          );

        const normalized =
          normalizeSnapshotBundle(
            raw,
          );

        expect(
          normalized,
        ).toEqual(raw);

        expect(
          Object.isFrozen(
            normalized.entries,
          ),
        ).toBe(true);
      },
    );

    it(
      "rejeita slot duplicado",
      () => {
        const slotId =
          createSnapshotSlotId(
            "slot.same",
          );

        expect(() =>
          createSnapshotBundle([
            {
              slotId,
              typeId:
                createSnapshotTypeId(
                  "runtime.a",
                ),
              schemaVersion: 1,
              state: {},
            },
            {
              slotId,
              typeId:
                createSnapshotTypeId(
                  "runtime.b",
                ),
              schemaVersion: 1,
              state: {},
            },
          ]),
        ).toThrow(
          SnapshotBundleError,
        );
      },
    );

    it(
      "rejeita payload não serializável",
      () => {
        expect(() =>
          createSnapshotBundle([
            {
              slotId:
                createSnapshotSlotId(
                  "slot.map",
                ),
              typeId:
                createSnapshotTypeId(
                  "runtime.map",
                ),
              schemaVersion: 1,
              state:
                new Map(),
            },
          ]),
        ).toThrow(
          SnapshotValueError,
        );
      },
    );
  },
);

describe(
  "Etapa 63 — Registry / Coordinator",
  () => {
    it(
      "registry é imutável conceitualmente e rejeita type duplicado",
      () => {
        const codec =
          defineSnapshotCodec({
            typeId:
              createSnapshotTypeId(
                "runtime.counter",
              ),
            schemaVersion: 1,

            isAggregate(
              value: unknown,
            ): value is Counter {
              return (
                value instanceof
                Counter
              );
            },

            capture(
              value: Counter,
            ) {
              return {
                value:
                  value.value,
              };
            },

            restore(
              state:
                {
                  readonly value:
                    number;
                },
            ) {
              return new Counter(
                state.value,
              );
            },
          });

        const runtime =
          toRuntimeSnapshotCodec(
            codec,
          );

        expect(() =>
          new DomainSnapshotRegistry([
            runtime,
            runtime,
          ]),
        ).toThrow(
          DomainSnapshotRegistryError,
        );
      },
    );

    it(
      "capture + restore padronizado preserva State/Currency/Tags",
      () => {
        const registry =
          createStandardSnapshotRegistry();

        const coordinator =
          new SnapshotCoordinator(
            registry,
          );

        const state =
          new StateStore();

        state.set(
          createStateKey(
            "state.answer",
          ),
          42,
        );

        const currency =
          new CurrencyAccount({
            currencyId:
              createCurrencyId(
                "currency.coins",
              ),
            balance: 100,
          });

        const tags =
          new TagSet([
            createDomainTag(
              "combat.fire",
            ),
          ]);

        const stateSlot =
          createSnapshotSlotId(
            "world.state",
          );

        const currencySlot =
          createSnapshotSlotId(
            "player.wallet.coins",
          );

        const tagsSlot =
          createSnapshotSlotId(
            "player.tags",
          );

        const bundle =
          coordinator.capture([
            {
              slotId:
                tagsSlot,
              typeId:
                TAG_SET_SNAPSHOT_TYPE_ID,
              value: tags,
            },
            {
              slotId:
                stateSlot,
              typeId:
                STATE_STORE_SNAPSHOT_TYPE_ID,
              value: state,
            },
            {
              slotId:
                currencySlot,
              typeId:
                CURRENCY_ACCOUNT_SNAPSHOT_TYPE_ID,
              value:
                currency,
            },
          ]);

        state.clear();
        currency.credit(5);
        tags.clear();

        const restored =
          coordinator.restore(
            bundle,
          );

        const restoredState =
          restored.require<
            StateStore
          >(stateSlot);

        const restoredCurrency =
          restored.require<
            CurrencyAccount
          >(currencySlot);

        const restoredTags =
          restored.require<
            TagSet
          >(tagsSlot);

        expect(
          restoredState.read(
            createStateKey(
              "state.answer",
            ),
          ),
        ).toBe(42);

        expect(
          restoredCurrency.balance,
        ).toBe(100);

        expect(
          restoredTags.has(
            createDomainTag(
              "combat.fire",
            ),
          ),
        ).toBe(true);

        expect(
          restored.getSlotIds(),
        ).toEqual([
          "player.tags",
          "player.wallet.coins",
          "world.state",
        ]);
      },
    );

    it(
      "rejeita schema de codec incompatível",
      () => {
        const coordinator =
          new SnapshotCoordinator(
            createStandardSnapshotRegistry(),
          );

        const bundle = {
          schemaVersion: 1,
          entries: [
            {
              slotId:
                "world.state",
              typeId:
                "runtime.state-store",
              schemaVersion: 99,
              state: {
                entries: [],
              },
            },
          ],
        };

        expect(() =>
          coordinator.restore(
            bundle,
          ),
        ).toThrow(
          SnapshotCoordinatorError,
        );
      },
    );

    it(
      "rejeita aggregate incompatível com codec no capture",
      () => {
        const coordinator =
          new SnapshotCoordinator(
            createStandardSnapshotRegistry(),
          );

        expect(() =>
          coordinator.capture([
            {
              slotId:
                createSnapshotSlotId(
                  "bad",
                ),
              typeId:
                STATE_STORE_SNAPSHOT_TYPE_ID,
              value:
                new TagSet(),
            },
          ]),
        ).toThrow(
          SnapshotCoordinatorError,
        );
      },
    );
  },
);
