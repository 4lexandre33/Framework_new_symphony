// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createModifierId,
  createModifierOperation,
  createModifierTargetId,
  Modifier,
  ModifierSet,
} from "../src/domain/mechanics";

import {
  createRandomSeedFromUint32,
  DeterministicRng,
} from "../src/domain/random";

import {
  createStateKey,
  StateStore,
} from "../src/domain/state";

import {
  createDomainTag,
  TagSet,
} from "../src/domain/tags";

interface BenchmarkResult {
  readonly label: string;
  readonly elapsedMs: number;
}

function benchmark(
  label: string,
  work: () => number,
): BenchmarkResult {
  work();

  const started =
    performance.now();

  const checksum =
    work();

  const elapsedMs =
    performance.now() -
    started;

  expect(
    Number.isFinite(
      checksum,
    ),
  ).toBe(true);

  return {
    label,
    elapsedMs,
  };
}

describe(
  "Etapa 67 — stress budgets headless",
  () => {
    it(
      "hot paths principais permanecem dentro de budget de regressão catastrófica",
      () => {
        const results:
          BenchmarkResult[] =
          [];

        const rng =
          new DeterministicRng(
            createRandomSeedFromUint32(
              67,
            ),
          );

        results.push(
          benchmark(
            "rng-500k",
            () => {
              let checksum = 0;

              for (
                let index = 0;
                index < 500_000;
                index += 1
              ) {
                checksum ^=
                  rng.nextUint32();
              }

              return checksum;
            },
          ),
        );

        const state =
          new StateStore();

        const key =
          createStateKey<number>(
            "state.stage67",
          );

        state.set(
          key,
          123,
        );

        results.push(
          benchmark(
            "state-read-has-500k",
            () => {
              let checksum = 0;

              for (
                let index = 0;
                index < 500_000;
                index += 1
              ) {
                if (
                  state.has(key)
                ) {
                  checksum +=
                    state.read(
                      key,
                    ) ??
                    0;
                }
              }

              return checksum;
            },
          ),
        );

        const tag =
          createDomainTag(
            "stage67.hot",
          );

        const tags =
          new TagSet([
            tag,
          ]);

        results.push(
          benchmark(
            "tag-has-500k",
            () => {
              let checksum = 0;

              for (
                let index = 0;
                index < 500_000;
                index += 1
              ) {
                if (
                  tags.has(tag)
                ) {
                  checksum += 1;
                }
              }

              return checksum;
            },
          ),
        );

        const modifiers =
          new ModifierSet();

        const targetId =
          createModifierTargetId(
            "attribute.stage67",
          );

        for (
          let index = 0;
          index < 128;
          index += 1
        ) {
          modifiers.add(
            new Modifier({
              id:
                createModifierId(
                  `modifier.stage67.${String(index).padStart(3, "0")}`,
                ),
              targetId,
              operation:
                createModifierOperation(
                  "add",
                  1,
                ),
              priority:
                index,
            }),
          );
        }

        results.push(
          benchmark(
            "modifier-evaluate-1.28m",
            () => {
              let checksum = 0;

              for (
                let index = 0;
                index < 10_000;
                index += 1
              ) {
                checksum +=
                  modifiers.evaluate(
                    targetId,
                    1,
                  );
              }

              return checksum;
            },
          ),
        );

        for (
          const result of
          results
        ) {
          expect(
            result.elapsedMs,
            `${result.label} excedeu budget de 8s: ${result.elapsedMs.toFixed(2)}ms`,
          ).toBeLessThan(
            8_000,
          );
        }

        const total =
          results.reduce(
            (
              sum,
              result,
            ) =>
              sum +
              result.elapsedMs,
            0,
          );

        expect(
          total,
          `stress total excedeu budget de 20s: ${total.toFixed(2)}ms`,
        ).toBeLessThan(
          20_000,
        );
      },
    );
  },
);
