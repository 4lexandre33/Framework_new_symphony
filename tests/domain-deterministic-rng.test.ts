// @vitest-environment node

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createRandomSeedFromString,
  createRandomSeedFromUint32,
  createRandomSeedFromWords,
  createRandomStreamId,
  deriveRandomSeed,
  DeterministicRng,
  DeterministicRngError,
  RandomSeedError,
  RandomStream,
  RandomStreamFactory,
  sameRandomSeed,
} from "../src/domain/random";

describe(
  "Etapa 64 — RandomSeed",
  () => {
    it(
      "mesma seed numérica produz mesmos 128 bits",
      () => {
        const left =
          createRandomSeedFromUint32(
            123456789,
          );

        const right =
          createRandomSeedFromUint32(
            123456789,
          );

        expect(
          sameRandomSeed(
            left,
            right,
          ),
        ).toBe(true);

        expect(
          left.words,
        ).toEqual(
          right.words,
        );
      },
    );

    it(
      "seed textual é determinística e sensível ao conteúdo exato",
      () => {
        const left =
          createRandomSeedFromString(
            "world-seed-alpha",
          );

        const same =
          createRandomSeedFromString(
            "world-seed-alpha",
          );

        const other =
          createRandomSeedFromString(
            "World-seed-alpha",
          );

        expect(
          sameRandomSeed(
            left,
            same,
          ),
        ).toBe(true);

        expect(
          sameRandomSeed(
            left,
            other,
          ),
        ).toBe(false);
      },
    );

    it(
      "rejeita seed words totalmente zero",
      () => {
        expect(() =>
          createRandomSeedFromWords([
            0,
            0,
            0,
            0,
          ]),
        ).toThrow(
          RandomSeedError,
        );
      },
    );

    it(
      "derivation é estável e não altera parent",
      () => {
        const parent =
          createRandomSeedFromString(
            "world",
          );

        const before =
          [...parent.words];

        const left =
          deriveRandomSeed(
            parent,
            "loot",
          );

        const right =
          deriveRandomSeed(
            parent,
            "loot",
          );

        expect(
          sameRandomSeed(
            left,
            right,
          ),
        ).toBe(true);

        expect(
          parent.words,
        ).toEqual(before);
      },
    );
  },
);

describe(
  "Etapa 64 — DeterministicRng",
  () => {
    it(
      "possui golden sequence estável para seed conhecida",
      () => {
        const rng =
          new DeterministicRng(
            createRandomSeedFromUint32(
              42,
            ),
          );

        const values =
          Array.from(
            {
              length: 8,
            },
            () =>
              rng.nextUint32(),
          );

        expect(values).toEqual([
          660444221,
          3652823732,
          77672526,
          910233633,
          2297337756,
          3786072677,
          3123505064,
          1891482476,
        ]);

        expect(
          rng.drawCount,
        ).toBe(8);
      },
    );

    it(
      "mesma seed + mesma call order reproduz sequência",
      () => {
        const seed =
          createRandomSeedFromString(
            "replay-001",
          );

        const left =
          new DeterministicRng(
            seed,
          );

        const right =
          new DeterministicRng(
            seed,
          );

        const a = [
          left.nextFloat(),
          left.nextInt(
            -5,
            12,
          ),
          left.nextBoolean(
            0.25,
          ),
          left.nextFloatRange(
            10,
            20,
          ),
        ];

        const b = [
          right.nextFloat(),
          right.nextInt(
            -5,
            12,
          ),
          right.nextBoolean(
            0.25,
          ),
          right.nextFloatRange(
            10,
            20,
          ),
        ];

        expect(a).toEqual(b);

        expect(
          left.drawCount,
        ).toBe(
          right.drawCount,
        );
      },
    );

    it(
      "nextFloat sempre fica em [0, 1)",
      () => {
        const rng =
          new DeterministicRng(
            createRandomSeedFromUint32(
              9,
            ),
          );

        for (
          let index = 0;
          index < 1_000;
          index += 1
        ) {
          const value =
            rng.nextFloat();

          expect(value).toBeGreaterThanOrEqual(
            0,
          );

          expect(value).toBeLessThan(
            1,
          );
        }
      },
    );

    it(
      "nextInt respeita limites inclusive/exclusive",
      () => {
        const rng =
          new DeterministicRng(
            createRandomSeedFromUint32(
              77,
            ),
          );

        for (
          let index = 0;
          index < 1_000;
          index += 1
        ) {
          const value =
            rng.nextInt(
              -3,
              7,
            );

          expect(
            Number.isInteger(
              value,
            ),
          ).toBe(true);

          expect(value)
            .toBeGreaterThanOrEqual(
              -3,
            );

          expect(value)
            .toBeLessThan(7);
        }
      },
    );

    it(
      "snapshot/restore continua exatamente da próxima amostra",
      () => {
        const rng =
          new DeterministicRng(
            createRandomSeedFromString(
              "snapshot-seed",
            ),
          );

        rng.nextUint32();
        rng.nextUint32();
        rng.nextUint32();

        const restored =
          DeterministicRng
            .fromSnapshot(
              rng.toSnapshot(),
            );

        const expected =
          Array.from(
            {
              length: 16,
            },
            () =>
              rng.nextUint32(),
          );

        const actual =
          Array.from(
            {
              length: 16,
            },
            () =>
              restored.nextUint32(),
          );

        expect(actual).toEqual(
          expected,
        );
      },
    );

    it(
      "clone não compartilha estado mutável",
      () => {
        const rng =
          new DeterministicRng(
            createRandomSeedFromUint32(
              100,
            ),
          );

        rng.nextUint32();

        const clone =
          rng.clone();

        expect(
          clone.nextUint32(),
        ).toBe(
          rng.nextUint32(),
        );

        clone.nextUint32();

        expect(
          clone.drawCount,
        ).not.toBe(
          rng.drawCount,
        );
      },
    );

    it(
      "rejeita ranges/probability inválidos",
      () => {
        const rng =
          new DeterministicRng(
            createRandomSeedFromUint32(
              1,
            ),
          );

        expect(() =>
          rng.nextInt(
            5,
            5,
          ),
        ).toThrow(
          DeterministicRngError,
        );

        expect(() =>
          rng.nextInt(
            0,
            0x1_0000_0001,
          ),
        ).toThrow(
          DeterministicRngError,
        );

        expect(() =>
          rng.nextBoolean(
            1.1,
          ),
        ).toThrow(
          DeterministicRngError,
        );
      },
    );
  },
);

describe(
  "Etapa 64 — RandomStream",
  () => {
    it(
      "factory torna streams independentes da ordem de criação/consumo",
      () => {
        const root =
          createRandomSeedFromString(
            "world-seed",
          );

        const firstFactory =
          new RandomStreamFactory(
            root,
          );

        const aiA =
          firstFactory.create(
            createRandomStreamId(
              "stream.ai",
            ),
          );

        const lootA =
          firstFactory.create(
            createRandomStreamId(
              "stream.loot",
            ),
          );

        aiA.nextUint32();
        aiA.nextUint32();
        aiA.nextUint32();

        const lootSequenceA =
          Array.from(
            {
              length: 8,
            },
            () =>
              lootA.nextUint32(),
          );

        const secondFactory =
          new RandomStreamFactory(
            root,
          );

        const lootB =
          secondFactory.create(
            createRandomStreamId(
              "stream.loot",
            ),
          );

        const lootSequenceB =
          Array.from(
            {
              length: 8,
            },
            () =>
              lootB.nextUint32(),
          );

        expect(
          lootSequenceB,
        ).toEqual(
          lootSequenceA,
        );
      },
    );

    it(
      "fork não depende do drawCount atual do parent",
      () => {
        const seed =
          createRandomSeedFromString(
            "parent",
          );

        const parentA =
          RandomStream.create(
            createRandomStreamId(
              "stream.parent",
            ),
            seed,
          );

        const childId =
          createRandomStreamId(
            "stream.child",
          );

        const childBefore =
          parentA.fork(
            childId,
          );

        parentA.nextUint32();
        parentA.nextUint32();
        parentA.nextUint32();

        const childAfter =
          parentA.fork(
            childId,
          );

        expect(
          Array.from(
            {
              length: 10,
            },
            () =>
              childBefore
                .nextUint32(),
          ),
        ).toEqual(
          Array.from(
            {
              length: 10,
            },
            () =>
              childAfter
                .nextUint32(),
          ),
        );
      },
    );

    it(
      "stream snapshot preserva seed de fork e estado corrente",
      () => {
        const stream =
          RandomStream.create(
            createRandomStreamId(
              "stream.loot",
            ),
            createRandomSeedFromString(
              "root",
            ),
          );

        stream.nextUint32();
        stream.nextUint32();

        const restored =
          RandomStream
            .fromSnapshot(
              stream.toSnapshot(),
            );

        expect(
          restored.nextUint32(),
        ).toBe(
          stream.nextUint32(),
        );

        const childId =
          createRandomStreamId(
            "stream.child",
          );

        expect(
          restored
            .fork(childId)
            .nextUint32(),
        ).toBe(
          stream
            .fork(childId)
            .nextUint32(),
        );
      },
    );
  },
);
