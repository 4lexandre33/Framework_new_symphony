const UINT32_MAX =
  0xffff_ffff;

const MAX_SEED_TEXT_LENGTH =
  1_024;

const MAX_DERIVATION_LABEL_LENGTH =
  256;

export interface RandomSeed {
  readonly words:
    readonly [
      number,
      number,
      number,
      number,
    ];
}

export interface RandomSeedSnapshot {
  readonly words:
    readonly [
      number,
      number,
      number,
      number,
    ];
}

export type RandomSeedErrorCode =
  | "invalid-uint32-seed"
  | "invalid-seed-text"
  | "invalid-seed-words"
  | "invalid-derivation-label";

export class RandomSeedError
  extends Error {
  public readonly name =
    "RandomSeedError";

  public constructor(
    public readonly code:
      RandomSeedErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function isUint32(
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
 * Mixer inteiro de 32 bits.
 *
 * Toda operação é explicitamente reduzida para uint32, evitando dependência de
 * precisão de ponto flutuante além das operações inteiras bem definidas do JS.
 */
function mix32(
  value: number,
): number {
  let x =
    (
      value +
      0x9e37_79b9
    ) >>> 0;

  x =
    Math.imul(
      x ^ (x >>> 16),
      0x21f0_aaad,
    ) >>> 0;

  x =
    Math.imul(
      x ^ (x >>> 15),
      0x735a_2d97,
    ) >>> 0;

  return (
    x ^
    (x >>> 15)
  ) >>> 0;
}

/**
 * Hash textual determinístico sobre code units UTF-16.
 *
 * Não usa TextEncoder, locale, filesystem, crypto ou plataforma.
 */
function hashText32(
  value: string,
): number {
  let hash =
    0x811c_9dc5;

  for (
    let index = 0;
    index < value.length;
    index += 1
  ) {
    const codeUnit =
      value.charCodeAt(
        index,
      );

    hash ^=
      codeUnit & 0xff;

    hash =
      Math.imul(
        hash,
        0x0100_0193,
      ) >>> 0;

    hash ^=
      codeUnit >>> 8;

    hash =
      Math.imul(
        hash,
        0x0100_0193,
      ) >>> 0;
  }

  hash ^=
    value.length >>> 0;

  return mix32(hash);
}

function freezeWords(
  words:
    readonly [
      number,
      number,
      number,
      number,
    ],
): readonly [
  number,
  number,
  number,
  number,
] {
  return Object.freeze([
    words[0],
    words[1],
    words[2],
    words[3],
  ]) as readonly [
    number,
    number,
    number,
    number,
  ];
}

function validateWords(
  words: unknown,
): readonly [
  number,
  number,
  number,
  number,
] {
  if (
    !Array.isArray(words) ||
    words.length !== 4 ||
    !isUint32(words[0]) ||
    !isUint32(words[1]) ||
    !isUint32(words[2]) ||
    !isUint32(words[3])
  ) {
    throw new RandomSeedError(
      "invalid-seed-words",
      "RandomSeed exige exatamente quatro uint32.",
    );
  }

  if (
    words[0] === 0 &&
    words[1] === 0 &&
    words[2] === 0 &&
    words[3] === 0
  ) {
    throw new RandomSeedError(
      "invalid-seed-words",
      "RandomSeed não pode possuir estado 128-bit totalmente zero.",
    );
  }

  return freezeWords([
    words[0],
    words[1],
    words[2],
    words[3],
  ]);
}

function expandSeed32(
  seed: number,
): RandomSeed {
  let state =
    seed >>> 0;

  const a =
    mix32(state);

  state =
    (
      state +
      0x9e37_79b9
    ) >>> 0;

  const b =
    mix32(state);

  state =
    (
      state +
      0x9e37_79b9
    ) >>> 0;

  const c =
    mix32(state);

  state =
    (
      state +
      0x9e37_79b9
    ) >>> 0;

  let d =
    mix32(state);

  if (
    a === 0 &&
    b === 0 &&
    c === 0 &&
    d === 0
  ) {
    d =
      0xa5a5_5a5a;
  }

  return Object.freeze({
    words:
      freezeWords([
        a,
        b,
        c,
        d,
      ]),
  });
}

export function createRandomSeedFromUint32(
  value: number,
): RandomSeed {
  if (!isUint32(value)) {
    throw new RandomSeedError(
      "invalid-uint32-seed",
      "Seed numérico deve ser inteiro no intervalo uint32 [0, 4294967295].",
    );
  }

  return expandSeed32(
    value,
  );
}

export function createRandomSeedFromString(
  value: string,
): RandomSeed {
  if (
    value.length === 0 ||
    value.length >
      MAX_SEED_TEXT_LENGTH
  ) {
    throw new RandomSeedError(
      "invalid-seed-text",
      `Seed textual deve ter entre 1 e ${String(MAX_SEED_TEXT_LENGTH)} code units.`,
    );
  }

  return expandSeed32(
    hashText32(value),
  );
}

export function createRandomSeedFromWords(
  words:
    readonly [
      number,
      number,
      number,
      number,
    ],
): RandomSeed {
  return Object.freeze({
    words:
      validateWords(words),
  });
}

/**
 * Deriva um novo seed sem consumir qualquer RNG.
 *
 * Mesmos parent seed + label => mesmo seed filho.
 */
export function deriveRandomSeed(
  parent: RandomSeed,
  label: string,
): RandomSeed {
  if (
    label.length === 0 ||
    label.length >
      MAX_DERIVATION_LABEL_LENGTH
  ) {
    throw new RandomSeedError(
      "invalid-derivation-label",
      `Derivation label deve ter entre 1 e ${String(MAX_DERIVATION_LABEL_LENGTH)} code units.`,
    );
  }

  const labelHash =
    hashText32(label);

  const words =
    parent.words;

  let a =
    mix32(
      words[0] ^
      labelHash,
    );

  let b =
    mix32(
      words[1] ^
      ((labelHash +
        0x9e37_79b9) >>>
        0),
    );

  let c =
    mix32(
      words[2] ^
      ((labelHash +
        0x3c6e_f372) >>>
        0),
    );

  let d =
    mix32(
      words[3] ^
      ((labelHash +
        0xdaa6_6d2b) >>>
        0),
    );

  a =
    mix32(
      a ^ words[3],
    );

  b =
    mix32(
      b ^ words[0],
    );

  c =
    mix32(
      c ^ words[1],
    );

  d =
    mix32(
      d ^ words[2],
    );

  if (
    a === 0 &&
    b === 0 &&
    c === 0 &&
    d === 0
  ) {
    d =
      0x6d2b_79f5;
  }

  return createRandomSeedFromWords([
    a,
    b,
    c,
    d,
  ]);
}

export function randomSeedToSnapshot(
  seed: RandomSeed,
): RandomSeedSnapshot {
  return Object.freeze({
    words:
      freezeWords(
        seed.words,
      ),
  });
}

export function randomSeedFromSnapshot(
  snapshot:
    RandomSeedSnapshot,
): RandomSeed {
  return createRandomSeedFromWords(
    snapshot.words,
  );
}

export function sameRandomSeed(
  left: RandomSeed,
  right: RandomSeed,
): boolean {
  return (
    left.words[0] ===
      right.words[0] &&
    left.words[1] ===
      right.words[1] &&
    left.words[2] ===
      right.words[2] &&
    left.words[3] ===
      right.words[3]
  );
}
