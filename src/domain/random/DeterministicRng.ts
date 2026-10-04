import {
  createRandomSeedFromWords,
} from "./RandomSeed";

import type {
  RandomSeed,
} from "./RandomSeed";

export const DETERMINISTIC_RNG_ALGORITHM =
  "xoshiro128ss-v1" as const;

const UINT32_RANGE =
  0x1_0000_0000;

const UINT32_MAX =
  0xffff_ffff;

export interface DeterministicRngSnapshot {
  readonly algorithm:
    typeof DETERMINISTIC_RNG_ALGORITHM;

  readonly state:
    readonly [
      number,
      number,
      number,
      number,
    ];

  readonly drawCount:
    number;
}

export type DeterministicRngErrorCode =
  | "invalid-snapshot"
  | "unsupported-algorithm"
  | "invalid-state"
  | "draw-count-overflow"
  | "invalid-integer-range"
  | "integer-range-too-wide"
  | "invalid-float-range"
  | "invalid-probability";

export class DeterministicRngError
  extends Error {
  public readonly name =
    "DeterministicRngError";

  public constructor(
    public readonly code:
      DeterministicRngErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function rotl32(
  value: number,
  shift: number,
): number {
  return (
    (value << shift) |
    (value >>> (32 - shift))
  ) >>> 0;
}

function assertUint32(
  value: unknown,
): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= UINT32_MAX
  );
}

/**
 * RNG xoshiro128** determinístico com estado 128-bit.
 *
 * Não existe fallback para fonte aleatória global. Todo estado nasce de
 * RandomSeed explícito ou snapshot explícito.
 */
export class DeterministicRng {
  private s0:
    number;

  private s1:
    number;

  private s2:
    number;

  private s3:
    number;

  private drawCountValue =
    0;

  public constructor(
    seed: RandomSeed,
  ) {
    const words =
      seed.words;

    this.s0 = words[0];
    this.s1 = words[1];
    this.s2 = words[2];
    this.s3 = words[3];

    this.assertNonZeroState();
  }

  private static fromState(
    state:
      readonly [
        number,
        number,
        number,
        number,
      ],
    drawCount: number,
  ): DeterministicRng {
    const seed =
      createRandomSeedFromWords(
        state,
      );

    const rng =
      new DeterministicRng(
        seed,
      );

    rng.drawCountValue =
      drawCount;

    return rng;
  }

  public static fromSnapshot(
    snapshot:
      DeterministicRngSnapshot,
  ): DeterministicRng {
    if (
      snapshot.algorithm !==
      DETERMINISTIC_RNG_ALGORITHM
    ) {
      throw new DeterministicRngError(
        "unsupported-algorithm",
        `Algoritmo RNG não suportado: "${String(snapshot.algorithm)}".`,
      );
    }

    if (
      !Array.isArray(
        snapshot.state,
      ) ||
      snapshot.state.length !==
        4 ||
      !assertUint32(
        snapshot.state[0],
      ) ||
      !assertUint32(
        snapshot.state[1],
      ) ||
      !assertUint32(
        snapshot.state[2],
      ) ||
      !assertUint32(
        snapshot.state[3],
      )
    ) {
      throw new DeterministicRngError(
        "invalid-state",
        "DeterministicRngSnapshot.state exige quatro uint32.",
      );
    }

    if (
      !Number.isSafeInteger(
        snapshot.drawCount,
      ) ||
      snapshot.drawCount < 0
    ) {
      throw new DeterministicRngError(
        "invalid-snapshot",
        "DeterministicRngSnapshot.drawCount deve ser inteiro seguro >= 0.",
      );
    }

    try {
      return DeterministicRng
        .fromState(
          [
            snapshot.state[0],
            snapshot.state[1],
            snapshot.state[2],
            snapshot.state[3],
          ],
          snapshot.drawCount,
        );
    } catch (error) {
      if (
        error instanceof
        DeterministicRngError
      ) {
        throw error;
      }

      throw new DeterministicRngError(
        "invalid-snapshot",
        `Snapshot RNG inválido: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );
    }
  }

  public get drawCount():
    number {
    return this.drawCountValue;
  }

  public nextUint32():
    number {
    if (
      this.drawCountValue >=
      Number.MAX_SAFE_INTEGER
    ) {
      throw new DeterministicRngError(
        "draw-count-overflow",
        "DeterministicRng.drawCount excederia Number.MAX_SAFE_INTEGER.",
      );
    }

    const result =
      Math.imul(
        rotl32(
          Math.imul(
            this.s1,
            5,
          ) >>> 0,
          7,
        ),
        9,
      ) >>> 0;

    const t =
      (this.s1 << 9) >>>
      0;

    this.s2 =
      (
        this.s2 ^
        this.s0
      ) >>> 0;

    this.s3 =
      (
        this.s3 ^
        this.s1
      ) >>> 0;

    this.s1 =
      (
        this.s1 ^
        this.s2
      ) >>> 0;

    this.s0 =
      (
        this.s0 ^
        this.s3
      ) >>> 0;

    this.s2 =
      (
        this.s2 ^
        t
      ) >>> 0;

    this.s3 =
      rotl32(
        this.s3,
        11,
      );

    this.drawCountValue +=
      1;

    return result;
  }

  /**
   * Float uniforme no intervalo [0, 1).
   */
  public nextFloat():
    number {
    return (
      this.nextUint32() /
      UINT32_RANGE
    );
  }

  /**
   * Inteiro uniforme no intervalo [minInclusive, maxExclusive).
   *
   * Usa rejection sampling para evitar modulo bias.
   */
  public nextInt(
    minInclusive: number,
    maxExclusive: number,
  ): number {
    if (
      !Number.isSafeInteger(
        minInclusive,
      ) ||
      !Number.isSafeInteger(
        maxExclusive,
      ) ||
      minInclusive >=
        maxExclusive
    ) {
      throw new DeterministicRngError(
        "invalid-integer-range",
        "nextInt exige inteiros seguros com minInclusive < maxExclusive.",
      );
    }

    const span =
      maxExclusive -
      minInclusive;

    if (
      span >
      UINT32_RANGE
    ) {
      throw new DeterministicRngError(
        "integer-range-too-wide",
        "nextInt suporta intervalos de no máximo 2^32 valores.",
      );
    }

    const limit =
      Math.floor(
        UINT32_RANGE /
          span,
      ) * span;

    let sample:
      number;

    do {
      sample =
        this.nextUint32();
    } while (
      sample >= limit
    );

    return (
      minInclusive +
      (sample % span)
    );
  }

  public nextFloatRange(
    minInclusive: number,
    maxExclusive: number,
  ): number {
    if (
      !Number.isFinite(
        minInclusive,
      ) ||
      !Number.isFinite(
        maxExclusive,
      ) ||
      minInclusive >=
        maxExclusive
    ) {
      throw new DeterministicRngError(
        "invalid-float-range",
        "nextFloatRange exige limites finitos com minInclusive < maxExclusive.",
      );
    }

    return (
      minInclusive +
      (
        maxExclusive -
        minInclusive
      ) *
      this.nextFloat()
    );
  }

  public nextBoolean(
    probabilityTrue:
      number = 0.5,
  ): boolean {
    if (
      !Number.isFinite(
        probabilityTrue,
      ) ||
      probabilityTrue < 0 ||
      probabilityTrue > 1
    ) {
      throw new DeterministicRngError(
        "invalid-probability",
        "nextBoolean probabilityTrue deve estar no intervalo [0, 1].",
      );
    }

    return (
      this.nextFloat() <
      probabilityTrue
    );
  }

  public clone():
    DeterministicRng {
    return DeterministicRng
      .fromSnapshot(
        this.toSnapshot(),
      );
  }

  public toSnapshot():
    DeterministicRngSnapshot {
    return Object.freeze({
      algorithm:
        DETERMINISTIC_RNG_ALGORITHM,

      state:
        Object.freeze([
          this.s0,
          this.s1,
          this.s2,
          this.s3,
        ]) as readonly [
          number,
          number,
          number,
          number,
        ],

      drawCount:
        this.drawCountValue,
    });
  }

  private assertNonZeroState():
    void {
    if (
      this.s0 === 0 &&
      this.s1 === 0 &&
      this.s2 === 0 &&
      this.s3 === 0
    ) {
      throw new DeterministicRngError(
        "invalid-state",
        "xoshiro128** não permite estado totalmente zero.",
      );
    }
  }
}
