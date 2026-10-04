import type {
  ResourceId,
} from "./ResourceId";

export interface ResourcePoolCreateOptions {
  readonly id:
    ResourceId;
  readonly max:
    number;
  readonly current?:
    number;
}

export interface ResourcePoolSnapshot {
  readonly id:
    string;
  readonly current:
    number;
  readonly max:
    number;
}

export type ResourcePoolErrorCode =
  | "invalid-max"
  | "invalid-current"
  | "invalid-amount"
  | "invalid-snapshot";

export class ResourcePoolError
  extends Error {
  public readonly name =
    "ResourcePoolError";

  public constructor(
    public readonly code:
      ResourcePoolErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function assertFiniteNonNegative(
  value: number,
  label: string,
  code:
    | "invalid-max"
    | "invalid-current"
    | "invalid-amount",
): void {
  if (
    !Number.isFinite(value) ||
    value < 0
  ) {
    throw new ResourcePoolError(
      code,
      `${label} deve ser um number finito maior ou igual a 0.`,
    );
  }
}

function assertFinitePositiveMax(
  value: number,
): void {
  if (
    !Number.isFinite(value) ||
    value <= 0
  ) {
    throw new ResourcePoolError(
      "invalid-max",
      "ResourcePool.max deve ser um number finito maior que 0.",
    );
  }
}

/**
 * Pool genérico de recurso de gameplay.
 *
 * Exemplos conceituais:
 * - resource.mana
 * - resource.stamina
 * - resource.energy
 * - resource.ammo-charge
 *
 * Não substitui automaticamente Agent.health e não conhece UI/engine.
 */
export class ResourcePool {
  public readonly id:
    ResourceId;

  private currentValue:
    number;

  private maxValue:
    number;

  public constructor(
    options:
      ResourcePoolCreateOptions,
  ) {
    assertFinitePositiveMax(
      options.max,
    );

    const current =
      options.current ??
      options.max;

    assertFiniteNonNegative(
      current,
      "ResourcePool.current",
      "invalid-current",
    );

    if (
      current > options.max
    ) {
      throw new ResourcePoolError(
        "invalid-current",
        "ResourcePool.current não pode ser maior que max.",
      );
    }

    this.id = options.id;
    this.currentValue =
      current;
    this.maxValue =
      options.max;
  }

  public static fromSnapshot(
    snapshot:
      ResourcePoolSnapshot,
  ): ResourcePool {
    try {
      return new ResourcePool({
        id:
          snapshot.id as ResourceId,
        current:
          snapshot.current,
        max:
          snapshot.max,
      });
    } catch (error) {
      throw new ResourcePoolError(
        "invalid-snapshot",
        `ResourcePoolSnapshot inválido: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );
    }
  }

  public get current():
    number {
    return this.currentValue;
  }

  public get max():
    number {
    return this.maxValue;
  }

  public get isEmpty():
    boolean {
    return (
      this.currentValue <= 0
    );
  }

  public get isFull():
    boolean {
    return (
      this.currentValue >=
      this.maxValue
    );
  }

  public get ratio01():
    number {
    return (
      this.currentValue /
      this.maxValue
    );
  }

  public canSpend(
    amount: number,
  ): boolean {
    assertFiniteNonNegative(
      amount,
      "ResourcePool.canSpend amount",
      "invalid-amount",
    );

    return (
      this.currentValue >=
      amount
    );
  }

  /**
   * Operação atômica:
   * - true: valor integral gasto;
   * - false: pool inalterado.
   */
  public trySpend(
    amount: number,
  ): boolean {
    assertFiniteNonNegative(
      amount,
      "ResourcePool.trySpend amount",
      "invalid-amount",
    );

    if (
      this.currentValue <
      amount
    ) {
      return false;
    }

    this.currentValue -=
      amount;

    return true;
  }

  /**
   * Adiciona recurso até max e retorna quanto foi efetivamente aplicado.
   */
  public gain(
    amount: number,
  ): number {
    assertFiniteNonNegative(
      amount,
      "ResourcePool.gain amount",
      "invalid-amount",
    );

    const capacity =
      this.maxValue -
      this.currentValue;

    const applied =
      amount < capacity
        ? amount
        : capacity;

    this.currentValue +=
      applied;

    return applied;
  }

  /**
   * Define current de forma explícita e estrita.
   * Não faz clamp silencioso.
   */
  public setCurrent(
    value: number,
  ): void {
    assertFiniteNonNegative(
      value,
      "ResourcePool.setCurrent value",
      "invalid-current",
    );

    if (
      value >
      this.maxValue
    ) {
      throw new ResourcePoolError(
        "invalid-current",
        "ResourcePool current não pode superar max.",
      );
    }

    this.currentValue =
      value;
  }

  /**
   * Altera a capacidade.
   *
   * Quando clampCurrent=true, current satura no novo max.
   * Quando false, reduzir max abaixo de current é erro.
   */
  public setMax(
    value: number,
    clampCurrent = true,
  ): void {
    assertFinitePositiveMax(
      value,
    );

    if (
      !clampCurrent &&
      this.currentValue >
      value
    ) {
      throw new ResourcePoolError(
        "invalid-current",
        "Novo max é menor que current e clampCurrent=false.",
      );
    }

    this.maxValue =
      value;

    if (
      this.currentValue >
      this.maxValue
    ) {
      this.currentValue =
        this.maxValue;
    }
  }

  public fill(): void {
    this.currentValue =
      this.maxValue;
  }

  public empty(): void {
    this.currentValue = 0;
  }

  public toSnapshot():
    ResourcePoolSnapshot {
    return {
      id: this.id,
      current:
        this.currentValue,
      max:
        this.maxValue,
    };
  }
}
