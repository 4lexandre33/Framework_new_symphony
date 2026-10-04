export class PerlinNoiseService {
  private static readonly PARK_MILLER_MODULUS =
    2147483647;

  private static readonly PARK_MILLER_MULTIPLIER =
    16807;

  private readonly permutation =
    new Uint16Array(
      512,
    );

  public constructor(
    seed = 1337,
  ) {
    this.reseed(
      seed,
    );
  }

  public reseed(
    seed: number,
  ): void {
    const source =
      new Uint16Array(
        256,
      );

    for (
      let index = 0;
      index < 256;
      index += 1
    ) {
      source[index] =
        index;
    }

    let state =
      this.normalizeSeed(
        seed,
      );

    for (
      let index = 255;
      index > 0;
      index -= 1
    ) {
      state =
        (
          state *
          PerlinNoiseService
            .PARK_MILLER_MULTIPLIER
        ) %
        PerlinNoiseService
          .PARK_MILLER_MODULUS;

      const swapIndex =
        state %
        (
          index +
          1
        );

      const temporary =
        source[index] ?? 0;

      source[index] =
        source[
          swapIndex
        ] ?? 0;

      source[swapIndex] =
        temporary;
    }

    for (
      let index = 0;
      index < 512;
      index += 1
    ) {
      this.permutation[index] =
        source[
          index &
          255
        ] ?? 0;
    }
  }

  public noise2D(
    x: number,
    y: number,
  ): number {
    const floorX =
      Math.floor(
        x,
      );

    const floorY =
      Math.floor(
        y,
      );

    const integerX =
      floorX &
      255;

    const integerY =
      floorY &
      255;

    const localX =
      x -
      floorX;

    const localY =
      y -
      floorY;

    const fadeX =
      this.fade(
        localX,
      );

    const fadeY =
      this.fade(
        localY,
      );

    const a =
      (
        this.permutation[
          integerX
        ] ??
        0
      ) +
      integerY;

    const b =
      (
        this.permutation[
          integerX +
          1
        ] ??
        0
      ) +
      integerY;

    const lower =
      this.lerp(
        fadeX,

        this.grad2D(
          this.permutation[
            a
          ] ??
            0,
          localX,
          localY,
        ),

        this.grad2D(
          this.permutation[
            b
          ] ??
            0,
          localX -
            1,
          localY,
        ),
      );

    const upper =
      this.lerp(
        fadeX,

        this.grad2D(
          this.permutation[
            a +
            1
          ] ??
            0,
          localX,
          localY -
            1,
        ),

        this.grad2D(
          this.permutation[
            b +
            1
          ] ??
            0,
          localX -
            1,
          localY -
            1,
        ),
      );

    return this.lerp(
      fadeY,
      lower,
      upper,
    );
  }

  public noise3D(
    x: number,
    y: number,
    z: number,
  ): number {
    const floorX =
      Math.floor(
        x,
      );

    const floorY =
      Math.floor(
        y,
      );

    const floorZ =
      Math.floor(
        z,
      );

    const integerX =
      floorX &
      255;

    const integerY =
      floorY &
      255;

    const integerZ =
      floorZ &
      255;

    const localX =
      x -
      floorX;

    const localY =
      y -
      floorY;

    const localZ =
      z -
      floorZ;

    const fadeX =
      this.fade(
        localX,
      );

    const fadeY =
      this.fade(
        localY,
      );

    const fadeZ =
      this.fade(
        localZ,
      );

    const a =
      (
        this.permutation[
          integerX
        ] ??
        0
      ) +
      integerY;

    const b =
      (
        this.permutation[
          integerX +
          1
        ] ??
        0
      ) +
      integerY;

    const aa =
      (
        this.permutation[
          a
        ] ??
        0
      ) +
      integerZ;

    const ab =
      (
        this.permutation[
          a +
          1
        ] ??
        0
      ) +
      integerZ;

    const ba =
      (
        this.permutation[
          b
        ] ??
        0
      ) +
      integerZ;

    const bb =
      (
        this.permutation[
          b +
          1
        ] ??
        0
      ) +
      integerZ;

    const firstPlane =
      this.lerp(
        fadeY,

        this.lerp(
          fadeX,

          this.grad3D(
            this.permutation[
              aa
            ] ??
              0,
            localX,
            localY,
            localZ,
          ),

          this.grad3D(
            this.permutation[
              ba
            ] ??
              0,
            localX -
              1,
            localY,
            localZ,
          ),
        ),

        this.lerp(
          fadeX,

          this.grad3D(
            this.permutation[
              ab
            ] ??
              0,
            localX,
            localY -
              1,
            localZ,
          ),

          this.grad3D(
            this.permutation[
              bb
            ] ??
              0,
            localX -
              1,
            localY -
              1,
            localZ,
          ),
        ),
      );

    const secondPlane =
      this.lerp(
        fadeY,

        this.lerp(
          fadeX,

          this.grad3D(
            this.permutation[
              aa +
              1
            ] ??
              0,
            localX,
            localY,
            localZ -
              1,
          ),

          this.grad3D(
            this.permutation[
              ba +
              1
            ] ??
              0,
            localX -
              1,
            localY,
            localZ -
              1,
          ),
        ),

        this.lerp(
          fadeX,

          this.grad3D(
            this.permutation[
              ab +
              1
            ] ??
              0,
            localX,
            localY -
              1,
            localZ -
              1,
          ),

          this.grad3D(
            this.permutation[
              bb +
              1
            ] ??
              0,
            localX -
              1,
            localY -
              1,
            localZ -
              1,
          ),
        ),
      );

    return this.lerp(
      fadeZ,
      firstPlane,
      secondPlane,
    );
  }

  public fractalNoise2D(
    x: number,
    y: number,
    octaves = 4,
    persistence = 0.5,
    lacunarity = 2,
  ): number {
    const safeOctaves =
      Math.max(
        1,
        Math.floor(
          Number.isFinite(
            octaves,
          )
            ? octaves
            : 4,
        ),
      );

    const safePersistence =
      Math.min(
        1,
        Math.max(
          0,
          Number.isFinite(
            persistence,
          )
            ? persistence
            : 0.5,
        ),
      );

    const safeLacunarity =
      Number.isFinite(
        lacunarity,
      ) &&
      lacunarity >
        0
        ? lacunarity
        : 2;

    let total =
      0;

    let frequency =
      1;

    let amplitude =
      1;

    let amplitudeSum =
      0;

    for (
      let octave = 0;
      octave <
      safeOctaves;
      octave += 1
    ) {
      total +=
        this.noise2D(
          x *
            frequency,
          y *
            frequency,
        ) *
        amplitude;

      amplitudeSum +=
        amplitude;

      amplitude *=
        safePersistence;

      frequency *=
        safeLacunarity;
    }

    if (
      amplitudeSum <=
      Number.EPSILON
    ) {
      return 0;
    }

    return (
      total /
      amplitudeSum
    );
  }

  private normalizeSeed(
    seed: number,
  ): number {
    let normalized =
      Number.isFinite(
        seed,
      )
        ? Math.trunc(
            seed,
          )
        : 1337;

    normalized %=
      PerlinNoiseService
        .PARK_MILLER_MODULUS;

    if (
      normalized <=
      0
    ) {
      normalized +=
        PerlinNoiseService
          .PARK_MILLER_MODULUS -
        1;
    }

    if (
      normalized <=
      0
    ) {
      return 1;
    }

    return normalized;
  }

  private fade(
    value: number,
  ): number {
    return (
      value *
      value *
      value *
      (
        value *
          (
            value *
              6 -
            15
          ) +
        10
      )
    );
  }

  private lerp(
    amount: number,
    start: number,
    end: number,
  ): number {
    return (
      start +
      amount *
        (
          end -
          start
        )
    );
  }

  private grad2D(
    hash: number,
    x: number,
    y: number,
  ): number {
    const gradient =
      hash &
      7;

    const primary =
      gradient <
      4
        ? x
        : y;

    const secondary =
      gradient <
      4
        ? y
        : x;

    return (
      (
        gradient &
        1
          ? -primary
          : primary
      ) +
      (
        gradient &
        2
          ? -2 *
            secondary
          : 2 *
            secondary
      )
    );
  }

  private grad3D(
    hash: number,
    x: number,
    y: number,
    z: number,
  ): number {
    const gradient =
      hash &
      15;

    const primary =
      gradient <
      8
        ? x
        : y;

    const secondary =
      gradient <
      4
        ? y
        : gradient ===
              12 ||
            gradient ===
              14
          ? x
          : z;

    return (
      (
        gradient &
        1
          ? -primary
          : primary
      ) +
      (
        gradient &
        2
          ? -secondary
          : secondary
      )
    );
  }
}