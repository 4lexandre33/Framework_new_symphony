import {
  createDomainId,
} from "../entities/DomainId";

import type {
  DomainId,
} from "../entities/DomainId";

import {
  DeterministicRng,
} from "./DeterministicRng";

import type {
  DeterministicRngSnapshot,
} from "./DeterministicRng";

import {
  deriveRandomSeed,
  randomSeedFromSnapshot,
  randomSeedToSnapshot,
} from "./RandomSeed";

import type {
  RandomSeed,
  RandomSeedSnapshot,
} from "./RandomSeed";

export type RandomStreamId =
  DomainId<
    "random-stream"
  >;

export interface RandomStreamSnapshot {
  readonly id:
    string;

  readonly seed:
    RandomSeedSnapshot;

  readonly rng:
    DeterministicRngSnapshot;
}

export type RandomStreamErrorCode =
  "invalid-snapshot";

export class RandomStreamError
  extends Error {
  public readonly name =
    "RandomStreamError";

  public constructor(
    public readonly code:
      RandomStreamErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function createRandomStreamId(
  value: string,
): RandomStreamId {
  return createDomainId<
    "random-stream"
  >(value);
}

/**
 * Stream RNG nomeado.
 *
 * A seed original fica preservada para fork determinístico. O estado corrente
 * do RNG é independente dessa seed após o primeiro draw.
 */
export class RandomStream {
  private constructor(
    public readonly id:
      RandomStreamId,

    private readonly seedValue:
      RandomSeed,

    private readonly rng:
      DeterministicRng,
  ) {}

  public static create(
    id:
      RandomStreamId,
    seed:
      RandomSeed,
  ): RandomStream {
    return new RandomStream(
      id,
      seed,
      new DeterministicRng(
        seed,
      ),
    );
  }

  public static fromSnapshot(
    snapshot:
      RandomStreamSnapshot,
  ): RandomStream {
    try {
      const id =
        createRandomStreamId(
          snapshot.id,
        );

      const seed =
        randomSeedFromSnapshot(
          snapshot.seed,
        );

      const rng =
        DeterministicRng
          .fromSnapshot(
            snapshot.rng,
          );

      return new RandomStream(
        id,
        seed,
        rng,
      );
    } catch (error) {
      throw new RandomStreamError(
        "invalid-snapshot",
        `RandomStreamSnapshot inválido: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );
    }
  }

  public get seed():
    RandomSeed {
    return this.seedValue;
  }

  public get drawCount():
    number {
    return this.rng.drawCount;
  }

  public nextUint32():
    number {
    return this.rng
      .nextUint32();
  }

  public nextFloat():
    number {
    return this.rng
      .nextFloat();
  }

  public nextInt(
    minInclusive: number,
    maxExclusive: number,
  ): number {
    return this.rng.nextInt(
      minInclusive,
      maxExclusive,
    );
  }

  public nextFloatRange(
    minInclusive: number,
    maxExclusive: number,
  ): number {
    return this.rng
      .nextFloatRange(
        minInclusive,
        maxExclusive,
      );
  }

  public nextBoolean(
    probabilityTrue:
      number = 0.5,
  ): boolean {
    return this.rng
      .nextBoolean(
        probabilityTrue,
      );
  }

  /**
   * Fork não consome o parent e depende apenas da seed estável do stream.
   */
  public fork(
    childId:
      RandomStreamId,
  ): RandomStream {
    return RandomStream.create(
      childId,
      deriveRandomSeed(
        this.seedValue,
        childId,
      ),
    );
  }

  public clone():
    RandomStream {
    return RandomStream
      .fromSnapshot(
        this.toSnapshot(),
      );
  }

  public toSnapshot():
    RandomStreamSnapshot {
    return Object.freeze({
      id: this.id,
      seed:
        randomSeedToSnapshot(
          this.seedValue,
        ),
      rng:
        this.rng.toSnapshot(),
    });
  }
}

/**
 * Factory stateless de streams nomeados.
 *
 * A sequência de um stream depende somente de rootSeed + streamId.
 * Criar/consumir outro stream não altera sua sequência.
 */
export class RandomStreamFactory {
  public constructor(
    public readonly rootSeed:
      RandomSeed,
  ) {}

  public create(
    id:
      RandomStreamId,
  ): RandomStream {
    return RandomStream.create(
      id,
      deriveRandomSeed(
        this.rootSeed,
        id,
      ),
    );
  }
}
